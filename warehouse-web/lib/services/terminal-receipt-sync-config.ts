import { timingSafeEqual } from "node:crypto";

import { ApiError } from "@/lib/api-response";
import { qinceOpenApiConfigured } from "@/lib/services/qince-terminal-receipt-client";

export const BROWSER_CONNECTOR_PENDING = "browser:pending";
export const BROWSER_CONNECTOR_PROCESSING_PREFIX = "browser:processing:";

export type TerminalReceiptSyncMode = "openapi" | "browser_connector" | "unconfigured";

export function getTerminalReceiptSyncMode(): TerminalReceiptSyncMode {
  const requestedMode = process.env.QINCE_SYNC_MODE?.trim().toLowerCase();
  if (requestedMode === "browser_connector") {
    return browserConnectorConfigured() ? "browser_connector" : "unconfigured";
  }
  if (requestedMode === "openapi") return qinceOpenApiConfigured() ? "openapi" : "unconfigured";
  if (browserConnectorConfigured()) return "browser_connector";
  if (qinceOpenApiConfigured()) return "openapi";
  return "unconfigured";
}

export function browserConnectorConfigured() {
  return Boolean(process.env.QINCE_BROWSER_CONNECTOR_TOKEN?.trim());
}

export function assertTerminalReceiptSyncConfigured() {
  const mode = getTerminalReceiptSyncMode();
  if (mode === "unconfigured") {
    throw new ApiError("自动同步尚未配置浏览器连接器，也没有可用的勤策 OpenAPI 凭据", 503);
  }
  return mode;
}

export function assertBrowserConnectorRequest(request: Request) {
  const expected = process.env.QINCE_BROWSER_CONNECTOR_TOKEN?.trim();
  const supplied = request.headers.get("x-warehouse-connector-token")?.trim();
  if (!expected || !supplied || !safeEqual(expected, supplied)) {
    throw new ApiError("浏览器连接器凭据无效", 401);
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
