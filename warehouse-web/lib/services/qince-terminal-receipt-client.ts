import { createPublicKey, publicEncrypt, constants as cryptoConstants } from "node:crypto";

import { ApiError } from "@/lib/api-response";

const LOGIN_ORIGIN = "https://cloud.qince.com";
const DEFAULT_EXPORT_TIMEOUT_MS = 3 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;

type FetchLike = typeof fetch;

type QinceCredentials = {
  tenantCode: string;
  userCode: string;
  password: string;
};

type QinceDownloadTask = {
  key: string;
  fileName: string;
  status: string;
  downloadPath: string;
  createTime: string;
};

export type QinceTerminalReceiptExport = {
  buffer: Buffer;
  fileName: string;
  taskKey: string;
};

export async function downloadQinceTerminalReceipts(input: {
  startDate: string;
  endDate: string;
  fetchImpl?: FetchLike;
}): Promise<QinceTerminalReceiptExport> {
  validateDate(input.startDate);
  validateDate(input.endDate);
  const credentials = readCredentials();
  const fetchImpl = input.fetchImpl ?? fetch;
  const session = await login(credentials, fetchImpl);
  const before = await listDownloadTasks(session, fetchImpl);
  const baseline = new Set(before.map((task) => task.key));

  const exportResponse = await session.request(
    "/app/goodscode/scancode/detail/codeExport.do",
    {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({
        timeBegin: input.startDate,
        timeEnd: input.endDate,
        awardSearchContent: "",
        awardCmId: "",
        exportColumns: [
          { field: "goodsCode", title: "码" },
          { field: "operateTime", title: "扫码时间" },
          { field: "operator", title: "扫码人" },
          { field: "productName", title: "商品名称" },
          { field: "goodsCodeUnit", title: "扫码商品单位" },
          { field: "receiveName", title: "收货单位名称" }
        ]
      })
    },
    fetchImpl
  );
  const exportPayload = await readJson(exportResponse, "创建签收导出任务失败");
  if (!isSuccessfulPayload(exportPayload)) {
    throw new ApiError(payloadMessage(exportPayload, "第三方系统拒绝创建签收导出任务"), 502);
  }

  const timeoutMs = positiveInteger(process.env.QINCE_EXPORT_TIMEOUT_MS, DEFAULT_EXPORT_TIMEOUT_MS);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(3_000);
    const tasks = await listDownloadTasks(session, fetchImpl);
    const candidate = tasks.find((task) => !baseline.has(task.key));
    if (!candidate) continue;
    if (candidate.status === "3" || candidate.status.toUpperCase() === "FAILURE") {
      throw new ApiError("第三方系统生成签收 Excel 失败", 502);
    }
    if (candidate.status !== "2" && candidate.status.toUpperCase() !== "SUCCESS") continue;
    if (!candidate.downloadPath) throw new ApiError("第三方系统已完成导出，但没有返回下载地址", 502);
    return downloadTask(candidate, fetchImpl);
  }

  throw new ApiError("等待第三方系统生成签收 Excel 超时，请稍后重试", 504);
}

function readCredentials(): QinceCredentials {
  const tenantCode = process.env.QINCE_TENANT_CODE?.trim();
  const userCode = process.env.QINCE_USER_CODE?.trim();
  const password = process.env.QINCE_PASSWORD;
  if (!tenantCode || !userCode || !password) {
    throw new ApiError("自动同步尚未配置勤策企业账号、账号和密码", 503);
  }
  return { tenantCode, userCode, password };
}

async function login(credentials: QinceCredentials, fetchImpl: FetchLike) {
  const jar = new CookieJar();
  const loginHeaders = qinceHeaders({
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: LOGIN_ORIGIN,
    Referer: `${LOGIN_ORIGIN}/`
  });
  const keyResponse = await requestWithCookies(
    `${LOGIN_ORIGIN}/loginsvr/getPublicKey.action`,
    { method: "POST", headers: loginHeaders },
    jar,
    fetchImpl
  );
  const keyPayload = await readJson(keyResponse, "读取第三方登录公钥失败");
  const publicKey = stringValue(keyPayload, "data");
  if (!isSuccessfulPayload(keyPayload) || !publicKey) {
    throw new ApiError(payloadMessage(keyPayload, "读取第三方登录公钥失败"), 502);
  }

  const password = encryptPassword(credentials.password, publicKey);
  const body = new URLSearchParams({
    type: "1",
    loginUrl: `${LOGIN_ORIGIN}/`,
    tenantCode: credentials.tenantCode,
    userCode: credentials.userCode,
    password
  });
  const authResponse = await requestWithCookies(
    `${LOGIN_ORIGIN}/loginsvr/auth.action`,
    { method: "POST", headers: loginHeaders, body },
    jar,
    fetchImpl
  );
  const authPayload = await readJson(authResponse, "第三方账号登录失败");
  if (!isSuccessfulPayload(authPayload)) {
    const code = stringValue(authPayload, "code");
    const message = payloadMessage(authPayload, "第三方账号登录失败");
    if (code === "3" || message.includes("校验码")) {
      throw new ApiError("勤策登录已触发校验码，请先在勤策网页完成一次登录校验后再同步", 409);
    }
    throw new ApiError(`勤策登录失败：${message}`, 502);
  }

  const appsvrUrl = stringValue(authPayload, "appsvrUrl");
  const token = stringValue(authPayload, "token");
  if (!appsvrUrl || !token) throw new ApiError("第三方登录成功但没有返回服务器地址或登录令牌", 502);
  const appOrigin = validatedQinceOrigin(appsvrUrl);
  const bootstrap = new URL("/platform/tokenInfo/login.do", appOrigin);
  bootstrap.searchParams.set("token", token);
  bootstrap.searchParams.set("appsvr", appsvrUrl);
  bootstrap.searchParams.set("loginUrl", `${LOGIN_ORIGIN}/`);
  bootstrap.searchParams.set("wqLang", "zh_CN");
  await requestWithCookies(
    bootstrap.toString(),
    { method: "GET", headers: qinceHeaders({ Referer: `${LOGIN_ORIGIN}/` }) },
    jar,
    fetchImpl,
    8
  );

  return {
    request(path: string, init: RequestInit, requestFetch: FetchLike) {
      return requestWithCookies(new URL(path, appOrigin).toString(), {
        ...init,
        headers: qinceHeaders(init.headers)
      }, jar, requestFetch);
    }
  };
}

async function listDownloadTasks(
  session: Awaited<ReturnType<typeof login>>,
  fetchImpl: FetchLike
) {
  const response = await session.request(
    "/platform/app/download/getDownloadInfo.do",
    {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({ page: 1, rows: 100 })
    },
    fetchImpl
  );
  const payload = await readJson(response, "读取第三方下载任务失败");
  if (!isSuccessfulPayload(payload)) {
    throw new ApiError(payloadMessage(payload, "读取第三方下载任务失败"), 502);
  }
  return extractRows(payload)
    .map(normalizeTask)
    .filter((task): task is QinceDownloadTask => Boolean(task))
    .sort((left, right) => right.createTime.localeCompare(left.createTime));
}

async function downloadTask(task: QinceDownloadTask, fetchImpl: FetchLike): Promise<QinceTerminalReceiptExport> {
  const url = new URL(task.downloadPath);
  if (url.protocol !== "https:") throw new ApiError("第三方下载地址不是安全的 HTTPS 地址", 502);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new ApiError(`下载签收 Excel 失败（HTTP ${response.status}）`, 502);
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_DOWNLOAD_BYTES) throw new ApiError("第三方签收 Excel 超过 15 MB，已停止导入", 502);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new ApiError("第三方返回的签收 Excel 是空文件", 502);
  if (buffer.length > MAX_DOWNLOAD_BYTES) throw new ApiError("第三方签收 Excel 超过 15 MB，已停止导入", 502);
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new ApiError("第三方下载内容不是有效的 .xlsx 文件", 502);
  return {
    buffer,
    fileName: sanitizeFileName(task.fileName || "码明细.xlsx"),
    taskKey: task.key
  };
}

function encryptPassword(password: string, publicKeyBase64: string) {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyBase64.replace(/\s+/g, ""), "base64"),
      format: "der",
      type: "spki"
    });
    // The Qince login helper invokes RSA encryption twice and submits the second result.
    publicEncrypt({ key, padding: cryptoConstants.RSA_PKCS1_PADDING }, Buffer.from(password, "utf8"));
    return publicEncrypt(
      { key, padding: cryptoConstants.RSA_PKCS1_PADDING },
      Buffer.from(password, "utf8")
    ).toString("base64");
  } catch {
    throw new ApiError("第三方登录公钥格式无法识别", 502);
  }
}

class CookieJar {
  private readonly values = new Map<string, string>();

  capture(headers: Headers) {
    const extended = headers as Headers & { getSetCookie?: () => string[] };
    const lines = extended.getSetCookie?.() ?? splitSetCookieHeader(headers.get("set-cookie"));
    for (const line of lines) {
      const pair = line.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) this.values.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }

  header() {
    return Array.from(this.values, ([name, value]) => `${name}=${value}`).join("; ");
  }
}

async function requestWithCookies(
  url: string,
  init: RequestInit,
  jar: CookieJar,
  fetchImpl: FetchLike,
  redirectsRemaining = 0
): Promise<Response> {
  const target = new URL(url);
  const headers = new Headers(init.headers);
  if (target.hostname.endsWith("qince.com") && jar.header()) headers.set("Cookie", jar.header());
  const response = await fetchImpl(target, {
    ...init,
    headers,
    redirect: redirectsRemaining > 0 ? "manual" : init.redirect,
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  jar.capture(response.headers);
  if (redirectsRemaining > 0 && [301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) return response;
    const nextUrl = new URL(location, target);
    validatedQinceOrigin(nextUrl.origin);
    const preserveMethod = response.status === 307 || response.status === 308;
    return requestWithCookies(
      nextUrl.toString(),
      {
        method: preserveMethod ? init.method : "GET",
        headers: qinceHeaders(),
        body: preserveMethod ? init.body : undefined
      },
      jar,
      fetchImpl,
      redirectsRemaining - 1
    );
  }
  return response;
}

function qinceHeaders(input?: HeadersInit) {
  const headers = new Headers(input);
  headers.set("Accept", "application/json, text/plain, */*");
  headers.set("h5-requested-with", "web");
  headers.set("wq-lang", "zh_CN");
  headers.set("User-Agent", "WarehouseTerminalReceiptSync/1.0");
  return headers;
}

async function readJson(response: Response, fallback: string): Promise<Record<string, unknown>> {
  if (!response.ok) throw new ApiError(`${fallback}（HTTP ${response.status}）`, 502);
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid payload");
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(`${fallback}：第三方系统返回了无法识别的数据`, 502);
  }
}

function extractRows(payload: Record<string, unknown>): unknown[] {
  if (Array.isArray(payload.rows)) return payload.rows;
  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    const data = payload.data as Record<string, unknown>;
    if (Array.isArray(data.rows)) return data.rows;
    if (Array.isArray(data.list)) return data.list;
  }
  return [];
}

function normalizeTask(value: unknown): QinceDownloadTask | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const fileName = firstString(row, ["fileName", "downloadFileName", "name"]);
  const downloadPath = firstString(row, ["downloadPath", "filePath", "url"]);
  const createTime = firstString(row, ["createTime", "createdAt", "createDate"]);
  const status = firstString(row, ["downloadStatus", "status"]);
  const explicitKey = firstString(row, ["id", "downloadId", "fileId", "taskId"]);
  if (!fileName && !downloadPath) return null;
  return {
    key: explicitKey || downloadPath || `${fileName}|${createTime}`,
    fileName: fileName || "码明细.xlsx",
    status,
    downloadPath,
    createTime
  };
}

function isSuccessfulPayload(payload: Record<string, unknown>) {
  return payload.success === true || String(payload.code ?? "") === "1";
}

function payloadMessage(payload: Record<string, unknown>, fallback: string) {
  return typeof payload.message === "string" && payload.message.trim() ? payload.message.trim() : fallback;
}

function stringValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function firstString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number") return String(value);
  }
  return "";
}

function validatedQinceOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith("qince.com")) {
    throw new ApiError("第三方系统返回了不受信任的服务器地址", 502);
  }
  return url.origin;
}

function splitSetCookieHeader(value: string | null) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=]+=[^;,]+)/g);
}

function sanitizeFileName(value: string) {
  const safe = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "码明细.xlsx";
  return safe.toLowerCase().endsWith(".xlsx") ? safe : `${safe}.xlsx`;
}

function validateDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError("自动同步日期格式无效", 500);
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
