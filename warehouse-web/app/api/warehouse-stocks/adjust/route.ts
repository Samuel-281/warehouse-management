import { fail, ok } from "@/lib/api-response";
import { assertSuperAdminAllowed } from "@/lib/auth-permissions";
import { logOperation } from "@/lib/services/operation-log-service";
import { adjustStockManually, type ManualStockAdjustmentInput } from "@/lib/services/stock-adjustment-service";

export async function POST(request: Request) {
  let user = null;
  try {
    user = await assertSuperAdminAllowed(request);
    const input = (await request.json()) as Omit<ManualStockAdjustmentInput, "operatorName">;
    const result = await adjustStockManually({ ...input, operatorName: user.displayName });
    await logOperation({
      user,
      request,
      action: "WAREHOUSE_STOCK_ADJUST",
      targetType: "WAREHOUSE_STOCK",
      targetId: `${result.warehouseId}:${result.goodsId}`,
      result: "SUCCESS",
      detail: `quantityChange=${result.quantityChange};reason=${input.reason?.trim() ?? ""}`
    });
    return ok(result);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "WAREHOUSE_STOCK_ADJUST",
      targetType: "WAREHOUSE_STOCK",
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
