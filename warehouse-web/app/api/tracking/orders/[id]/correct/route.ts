import { fail, ok } from "@/lib/api-response";
import { assertSuperAdminAllowed } from "@/lib/auth-permissions";
import { correctTrackingRoute } from "@/lib/services/tracking-governance-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let user = null;
  const { id } = await context.params;
  try {
    user = await assertSuperAdminAllowed(request);
    const input = (await request.json()) as { type?: "sales_outbound" | "transfer"; sourceWarehouseId?: string; targetWarehouseId?: string; salespersonId?: string; note?: string };
    const result = await correctTrackingRoute({
      targetType: "order",
      targetId: id,
      type: input.type ?? "sales_outbound",
      sourceWarehouseId: input.sourceWarehouseId ?? "",
      targetWarehouseId: input.targetWarehouseId,
      salespersonId: input.salespersonId,
      note: input.note,
      operatorName: user.displayName,
      operatorUserId: user.id
    });
    await logOperation({
      user,
      request,
      action: "TRACKING_ORDER_CORRECT",
      targetType: "TRACKING_ORDER",
      targetId: id,
      result: "SUCCESS",
      detail: `单号：${result.number}；纠正范围：${result.correctionMode === "history_only" ? "仅历史单据信息" : "单据及当前归属"}；当前状态变更条码：${result.updatedBarcodeCount}`
    });
    return ok(result);
  } catch (error) {
    await logOperation({ user, request, action: "TRACKING_ORDER_CORRECT", targetType: "TRACKING_ORDER", targetId: id, result: "FAILURE", detail: error instanceof Error ? error.message : undefined });
    return fail(error, 400);
  }
}
