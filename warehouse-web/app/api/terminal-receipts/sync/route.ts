import { fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed, requireCurrentUser } from "@/lib/auth-permissions";
import {
  createTerminalReceiptSyncRun,
  executeTerminalReceiptSync,
  getTerminalReceiptSyncOverview
} from "@/lib/services/terminal-receipt-sync-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    const url = new URL(request.url);
    return ok(await getTerminalReceiptSyncOverview(Number(url.searchParams.get("limit") ?? "10")));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await assertWarehouseOperationAllowed(request);
    const run = await createTerminalReceiptSyncRun({
      trigger: "MANUAL",
      operatorName: user.displayName
    });

    // The task continues in the persistent ECS process while the page polls its status.
    void executeTerminalReceiptSync(run.id).catch((error) => {
      console.error("Terminal receipt sync task stopped unexpectedly", error);
    });
    return ok(run, { status: 202 });
  } catch (error) {
    return fail(error);
  }
}
