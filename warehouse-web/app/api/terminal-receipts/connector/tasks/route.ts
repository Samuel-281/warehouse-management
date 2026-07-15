import { ApiError, fail, ok } from "@/lib/api-response";
import {
  claimBrowserConnectorTask,
  completeBrowserConnectorTask,
  failBrowserConnectorTask
} from "@/lib/services/terminal-receipt-browser-connector-service";
import { assertBrowserConnectorRequest } from "@/lib/services/terminal-receipt-sync-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertBrowserConnectorRequest(request);
    return ok(await claimBrowserConnectorTask());
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertBrowserConnectorRequest(request);
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ApiError("连接器回传内容格式无效", 400);
    }
    const value = body as Record<string, unknown>;
    const runId = stringValue(value.runId);
    const claimToken = stringValue(value.claimToken);
    const errorMessage = stringValue(value.errorMessage);
    if (errorMessage) return ok(await failBrowserConnectorTask({ runId, claimToken, errorMessage }));
    if (!Array.isArray(value.records)) throw new ApiError("连接器没有回传扫码记录", 400);
    return ok(await completeBrowserConnectorTask({
      runId,
      claimToken,
      records: value.records
    }));
  } catch (error) {
    return fail(error);
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
