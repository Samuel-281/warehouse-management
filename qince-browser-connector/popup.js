const serverUrlInput = document.querySelector("#serverUrl");
const tokenInput = document.querySelector("#connectorToken");
const statusBox = document.querySelector("#status");

void initialize();

document.querySelector("#save").addEventListener("click", async () => {
  await saveSettings();
  showStatus({ state: "success", message: "配置已保存" });
});

document.querySelector("#test").addEventListener("click", async () => {
  await saveSettings();
  setBusy(true, "正在测试勤策登录状态");
  showStatus(await chrome.runtime.sendMessage({ type: "TEST_CONNECTION" }));
  setBusy(false);
});

document.querySelector("#sync").addEventListener("click", async () => {
  await saveSettings();
  setBusy(true, "正在检查待同步任务");
  showStatus(await chrome.runtime.sendMessage({ type: "SYNC_NOW" }));
  setBusy(false);
});

async function initialize() {
  const stored = await chrome.storage.local.get(["serverUrl", "connectorToken", "lastStatus"]);
  serverUrlInput.value = stored.serverUrl || "http://localhost:3002";
  tokenInput.value = stored.connectorToken || "";
  if (stored.lastStatus) showStatus(stored.lastStatus);
}

async function saveSettings() {
  const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(serverUrl)) throw new Error("仓库系统地址必须以 http:// 或 https:// 开头");
  await chrome.storage.local.set({ serverUrl, connectorToken: tokenInput.value.trim() });
}

function showStatus(value) {
  statusBox.dataset.state = value?.state || "idle";
  statusBox.textContent = value?.message || "尚未运行";
}

function setBusy(busy, message) {
  for (const button of document.querySelectorAll("button")) button.disabled = busy;
  if (busy) showStatus({ state: "running", message });
}
