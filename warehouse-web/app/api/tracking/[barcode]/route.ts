import { fail, ok } from "@/lib/api-response";
import { assertSuperAdminAllowed, requireCurrentUser } from "@/lib/auth-permissions";
import { deleteTrackedBarcodeRecords } from "@/lib/services/tracking-governance-service";
import { logOperation } from "@/lib/services/operation-log-service";
import { getTrackedBarcodeDetail } from "@/lib/services/tracking-service";

export async function GET(request: Request, context: { params: Promise<{ barcode: string }> }) {
  try {
    await requireCurrentUser(request);
    const { barcode } = await context.params;
    return ok(await getTrackedBarcodeDetail(decodeURIComponent(barcode)));
  } catch (error) {
    return fail(error, 404);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ barcode: string }> }) {
  let user = null;
  const { barcode } = await context.params;
  const decoded = decodeURIComponent(barcode);
  try {
    user = await assertSuperAdminAllowed(request);
    const input = (await request.json().catch(() => ({}))) as { note?: string };
    const result = await deleteTrackedBarcodeRecords({ barcode: decoded, note: input.note, operatorName: user.displayName, operatorUserId: user.id });
    await logOperation({ user, request, action: "TRACKING_BARCODE_DELETE", targetType: "TRACKED_BARCODE", targetId: decoded, result: "SUCCESS", detail: `无勤策签收记录的错误条码档案、本地流转和单据关联已删除${input.note?.trim() ? `；备注：${input.note.trim()}` : ""}` });
    return ok(result);
  } catch (error) {
    await logOperation({ user, request, action: "TRACKING_BARCODE_REMOVE", targetType: "TRACKED_BARCODE", targetId: decoded, result: "FAILURE", detail: error instanceof Error ? error.message : undefined });
    return fail(error, 400);
  }
}
