const ALARM_NAME = "warehouse-qince-sync";
const DEFAULT_SERVER_URL = "http://localhost:3002";
const TASK_PATH = "/api/terminal-receipts/connector/tasks";
const DEFAULT_POLL_MINUTES = 1;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: DEFAULT_POLL_MINUTES });
  await runPendingTask("installed");
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: DEFAULT_POLL_MINUTES });
  await runPendingTask("startup");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void runPendingTask("alarm");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SYNC_NOW") {
    void runPendingTask("manual").then(sendResponse);
    return true;
  }
  if (message?.type === "TEST_CONNECTION") {
    void testConnection().then(sendResponse);
    return true;
  }
  return false;
});

async function runPendingTask(source) {
  const settings = await readSettings();
  if (!settings.connectorToken) return status("not_configured", "请先填写连接器密钥");

  let task;
  try {
    task = await requestWarehouse(settings, "GET");
  } catch (error) {
    return remember(status("error", messageOf(error)));
  }
  if (!task) return remember(status("idle", "当前没有待同步任务"));

  await remember(status("running", `正在同步 ${task.startDate} 至 ${task.endDate}`));
  try {
    const records = await readQinceRecords(task);
    const result = await requestWarehouse(settings, "POST", {
      runId: task.id,
      claimToken: task.claimToken,
      records
    });
    return remember(status(
      "success",
      `同步完成：读取 ${records.length} 条，新增 ${result.importedRows} 条，重复 ${result.duplicateRows} 条`,
      { source, taskId: task.id }
    ));
  } catch (error) {
    const errorMessage = messageOf(error);
    try {
      await requestWarehouse(settings, "POST", {
        runId: task.id,
        claimToken: task.claimToken,
        errorMessage
      });
    } catch {
      // The original error remains more useful than a secondary reporting error.
    }
    return remember(status("error", errorMessage, { source, taskId: task.id }));
  }
}

async function readQinceRecords(task) {
  const allRows = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(task.queryUrl, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=UTF-8"
      },
      body: JSON.stringify({
        timeBegin: task.startDate,
        timeEnd: task.endDate,
        awardSearchContent: "",
        awardCmId: "",
        goodscode: "",
        menuId: task.menuId,
        page,
        rows: task.pageSize
      })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`勤策查询失败（HTTP ${response.status}）`);
    if (looksLikeHtml(text)) throw new Error("勤策登录状态已失效，请先在 Chrome 中重新登录勤策");

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("勤策返回了无法识别的数据，请确认当前账号可以查看扫码明细");
    }
    const { rows, total } = extractRows(payload);
    allRows.push(...rows.map(normalizeRow));
    if (allRows.length > task.maxRecords) {
      throw new Error(`本次记录超过 ${task.maxRecords} 条，请缩短同步日期范围`);
    }
    if (rows.length < task.pageSize || (Number.isFinite(total) && allRows.length >= total)) break;
  }
  return allRows;
}

function extractRows(payload) {
  const candidates = [payload, payload?.data, payload?.result, payload?.response_data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return { rows: candidate, total: candidate.length };
    if (candidate && typeof candidate === "object") {
      for (const key of ["rows", "list", "records", "data"]) {
        if (Array.isArray(candidate[key])) {
          return { rows: candidate[key], total: Number(candidate.total ?? candidate.count ?? candidate[key].length) };
        }
      }
    }
  }
  const message = payload?.message || payload?.msg || payload?.error || "勤策没有返回扫码明细列表";
  throw new Error(String(message));
}

function normalizeRow(row) {
  const normalized = {
    id: valueOf(row.id, row.recordId),
    goodsCode: valueOf(row.goodsCode, row.scancode, row.barcode, row.code),
    operateTime: valueOf(row.operateTime, row.operate_time, row.scanTime, row.scan_time),
    operator: valueOf(row.operator, row.operatorName, row.operator_name),
    productName: valueOf(row.productName, row.product_name, row.goodsName, row.goods_name, row.pd_name) || "勤策扫码签收记录",
    goodsCodeUnit: valueOf(row.goodsCodeUnit, row.goodsUnit, row.goods_unit, row.unitName, row.unit_name) || "件",
    receiveName: valueOf(row.receiveName, row.customerName, row.customer_name, row.receivingOrganizationName)
  };
  if (!normalized.goodsCode || !normalized.operateTime || !normalized.operator || !normalized.receiveName) {
    throw new Error("勤策扫码明细缺少箱码、扫码时间、扫码人或收货单位");
  }
  return normalized;
}

async function requestWarehouse(settings, method, body) {
  const response = await fetch(`${settings.serverUrl}${TASK_PATH}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Warehouse-Connector-Token": settings.connectorToken
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`仓库系统返回了无法识别的数据（HTTP ${response.status}）`);
  }
  if (!response.ok || !("data" in payload)) throw new Error(payload.error || `仓库系统请求失败（HTTP ${response.status}）`);
  return payload.data;
}

async function testConnection() {
  const settings = await readSettings();
  if (!settings.connectorToken) return status("not_configured", "请先填写连接器密钥");
  try {
    const response = await fetch("https://cloud.region2.qince.com/app/goodscode/scancode/detail/codelist.do", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({
        timeBegin: today(),
        timeEnd: today(),
        awardSearchContent: "",
        awardCmId: "",
        goodscode: "",
        menuId: "9154495129720347956",
        page: 1,
        rows: 1
      })
    });
    const text = await response.text();
    if (!response.ok || looksLikeHtml(text)) throw new Error("勤策登录状态不可用，请先登录勤策扫码明细页面");
    JSON.parse(text);
    return remember(status("success", "勤策登录会话可用，连接器可以按自定义日期查询"));
  } catch (error) {
    return remember(status("error", messageOf(error)));
  }
}

async function readSettings() {
  const stored = await chrome.storage.local.get(["serverUrl", "connectorToken"]);
  return {
    serverUrl: normalizeServerUrl(stored.serverUrl || DEFAULT_SERVER_URL),
    connectorToken: String(stored.connectorToken || "").trim()
  };
}

function normalizeServerUrl(value) {
  return String(value).trim().replace(/\/+$/, "");
}

function looksLikeHtml(value) {
  return /^\s*</.test(value);
}

function valueOf(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function status(state, message, extra = {}) {
  return { state, message, at: new Date().toISOString(), ...extra };
}

async function remember(value) {
  await chrome.storage.local.set({ lastStatus: value });
  return value;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || "连接器同步失败");
}
