import { createHash, randomUUID } from "node:crypto";

import ExcelJS from "exceljs";

import { ApiError } from "@/lib/api-response";

const DEFAULT_OPENAPI_BASE_URL = "https://openapi.qince.com";
const REQUEST_TIMEOUT_MS = 30 * 1000;
const PAGE_SIZE = 1_000;
const MAX_RECORDS = 10_000;

type FetchLike = typeof fetch;

type QinceOpenApiCredentials = {
  openId: string;
  appKey: string;
  baseUrl: URL;
};

export type QinceScanRecord = {
  id: string;
  barcode: string;
  scannedAt: string;
  scannerName: string;
  externalGoodsName: string;
  goodsUnit: string;
  receivingOrganizationName: string;
};

export type QinceTerminalReceiptExport = {
  buffer: Buffer;
  fileName: string;
  taskKey: string;
  recordCount: number;
};

export type QinceBrowserScanRecord = {
  id?: unknown;
  goodsCode?: unknown;
  operateTime?: unknown;
  operator?: unknown;
  productName?: unknown;
  goodsCodeUnit?: unknown;
  receiveName?: unknown;
};

export function qinceOpenApiConfigured() {
  return Boolean(process.env.QINCE_OPENID?.trim() && process.env.QINCE_APPKEY?.trim());
}

export function assertQinceOpenApiConfigured() {
  if (!qinceOpenApiConfigured()) {
    throw new ApiError("自动同步尚未配置勤策 OpenAPI 的 OpenID 和 AppKey", 503);
  }
}

export async function downloadQinceTerminalReceipts(input: {
  startDate: string;
  endDate: string;
  fetchImpl?: FetchLike;
}): Promise<QinceTerminalReceiptExport> {
  validateDate(input.startDate);
  validateDate(input.endDate);
  const credentials = readCredentials();
  const fetchImpl = input.fetchImpl ?? fetch;
  const records: QinceScanRecord[] = [];

  for (let page = 1; ; page += 1) {
    const pageRows = await queryScanRecords({
      credentials,
      startDate: input.startDate,
      endDate: input.endDate,
      page,
      fetchImpl
    });
    if (records.length + pageRows.length > MAX_RECORDS) {
      throw new ApiError(`本次勤策扫码记录超过 ${MAX_RECORDS.toLocaleString("zh-CN")} 条，请缩短同步日期范围`, 413);
    }
    records.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
  }

  const fileName = `勤策扫码明细_${input.startDate}_${input.endDate}.xlsx`;
  const buffer = await buildWorkbook(records);
  const taskKey = createHash("sha256")
    .update(`${input.startDate}|${input.endDate}|${records.map((row) => row.id || receiptKey(row)).join("|")}`)
    .digest("hex");

  return { buffer, fileName, taskKey, recordCount: records.length };
}

export async function buildQinceBrowserTerminalReceiptExport(input: {
  startDate: string;
  endDate: string;
  records: QinceBrowserScanRecord[];
}): Promise<QinceTerminalReceiptExport> {
  validateDate(input.startDate);
  validateDate(input.endDate);
  if (input.records.length > MAX_RECORDS) {
    throw new ApiError(`本次勤策扫码记录超过 ${MAX_RECORDS.toLocaleString("zh-CN")} 条，请缩短同步日期范围`, 413);
  }

  const records = input.records.map((row, index) => normalizeScanRecord(row, 1, index));
  const fileName = `勤策浏览器同步_${input.startDate}_${input.endDate}.xlsx`;
  const buffer = await buildWorkbook(records);
  const taskKey = createHash("sha256")
    .update(`${input.startDate}|${input.endDate}|${records.map((row) => row.id || receiptKey(row)).join("|")}`)
    .digest("hex");
  return { buffer, fileName, taskKey, recordCount: records.length };
}

async function queryScanRecords(input: {
  credentials: QinceOpenApiCredentials;
  startDate: string;
  endDate: string;
  page: number;
  fetchImpl: FetchLike;
}) {
  const body = JSON.stringify({
    date_start: input.startDate,
    date_end: input.endDate,
    page: String(input.page),
    rows: String(PAGE_SIZE)
  });
  const timestamp = String(Date.now());
  const digest = createHash("md5")
    .update(`${body}|${input.credentials.appKey}|${timestamp}`)
    .digest("hex");
  const messageId = randomUUID().replaceAll("-", "");
  const path = [
    "api",
    "scancode",
    "v1",
    "queryScancodeRecords",
    encodeURIComponent(input.credentials.openId),
    timestamp,
    digest,
    messageId
  ].join("/");
  const url = new URL(path, ensureTrailingSlash(input.credentials.baseUrl));

  let response: Response;
  try {
    response = await input.fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json;charset=utf-8",
        "User-Agent": "WarehouseTerminalReceiptSync/2.0"
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new ApiError("连接勤策 OpenAPI 超时，请稍后重试", 504);
    }
    throw new ApiError("无法连接勤策 OpenAPI，请检查服务器网络和信任 IP 配置", 502);
  }
  if (!response.ok) throw new ApiError(`勤策 OpenAPI 请求失败（HTTP ${response.status}）`, 502);

  const payload = await readPayload(response);
  if (String(payload.return_code ?? "") !== "0") {
    const message = stringValue(payload.return_msg) || "勤策 OpenAPI 拒绝了本次查询";
    throw new ApiError(`勤策 OpenAPI 同步失败：${message}`, 502);
  }
  return extractResponseRows(payload.response_data).map((row, index) => normalizeScanRecord(row, input.page, index));
}

async function buildWorkbook(records: QinceScanRecord[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "仓库货物管理系统";
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  const worksheet = workbook.addWorksheet("扫码明细");
  worksheet.addRow(["码", "扫码时间", "扫码人", "商品名称", "扫码商品单位", "收货单位名称"]);
  for (const record of records) {
    worksheet.addRow([
      record.barcode,
      record.scannedAt,
      record.scannerName,
      record.externalGoodsName,
      record.goodsUnit,
      record.receivingOrganizationName
    ]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function readCredentials(): QinceOpenApiCredentials {
  const openId = process.env.QINCE_OPENID?.trim();
  const appKey = process.env.QINCE_APPKEY?.trim();
  if (!openId || !appKey) {
    throw new ApiError("自动同步尚未配置勤策 OpenAPI 的 OpenID 和 AppKey", 503);
  }
  const rawBaseUrl = process.env.QINCE_OPENAPI_BASE_URL?.trim() || DEFAULT_OPENAPI_BASE_URL;
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new ApiError("勤策 OpenAPI 地址格式无效", 500);
  }
  if (baseUrl.protocol !== "https:" || !isTrustedQinceHost(baseUrl.hostname)) {
    throw new ApiError("勤策 OpenAPI 地址必须是受信任的 HTTPS 地址", 500);
  }
  return { openId, appKey, baseUrl };
}

async function readPayload(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid payload");
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError("勤策 OpenAPI 返回了无法识别的数据", 502);
  }
}

function extractResponseRows(value: unknown): unknown[] {
  let data = value;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      throw new ApiError("勤策 OpenAPI 返回的扫码明细格式无效", 502);
    }
  }
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.rows)) return record.rows;
    if (Array.isArray(record.list)) return record.list;
    if (Array.isArray(record.data)) return record.data;
  }
  if (data === null || data === undefined || data === "") return [];
  throw new ApiError("勤策 OpenAPI 返回的扫码明细不是列表", 502);
}

function normalizeScanRecord(value: unknown, page: number, index: number): QinceScanRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(`勤策 OpenAPI 第 ${page} 页第 ${index + 1} 条记录格式无效`, 502);
  }
  const row = value as Record<string, unknown>;
  const barcode = firstString(row, ["scancode", "goodsCode", "barcode", "code"]);
  const scannedAt = firstString(row, ["operate_time", "operateTime", "scan_time", "scanTime"]);
  const scannerName = firstString(row, ["operator_name", "operatorName", "operator"]);
  const receivingOrganizationName = firstString(row, ["customer_name", "customerName", "receiveName", "receivingOrganizationName"]);
  if (!barcode || !scannedAt || !scannerName || !receivingOrganizationName) {
    throw new ApiError(`勤策 OpenAPI 第 ${page} 页第 ${index + 1} 条记录缺少条码、扫码时间、扫码人或收货单位`, 502);
  }
  return {
    id: firstString(row, ["id", "record_id", "recordId"]),
    barcode,
    scannedAt,
    scannerName,
    externalGoodsName: firstString(row, ["product_name", "productName", "goods_name", "goodsName", "pd_name"]) || "勤策扫码签收记录",
    goodsUnit: firstString(row, ["goods_unit", "goodsUnit", "goodsCodeUnit", "unit_name", "unitName", "code_unit"]) || "件",
    receivingOrganizationName
  };
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value);
}

function receiptKey(record: QinceScanRecord) {
  return [record.barcode, record.scannedAt, record.scannerName, record.receivingOrganizationName].join("\u001f");
}

function ensureTrailingSlash(value: URL) {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function isTrustedQinceHost(hostname: string) {
  return hostname === "qince.com" || hostname.endsWith(".qince.com") || hostname === "waiqin365.com" || hostname.endsWith(".waiqin365.com");
}

function validateDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError("自动同步日期格式无效", 500);
}
