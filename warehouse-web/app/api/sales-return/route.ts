import { fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed } from "@/lib/auth-permissions";
import { submitSalesReturn, type SubmitSalesReturnInput } from "@/lib/services/sales-return-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function POST(request: Request) {
  let user = null;
  try {
    user = await assertWarehouseOperationAllowed(request);
    const input = (await request.json()) as SubmitSalesReturnInput;
    const result = await submitSalesReturn({ ...input, operatorName: user.displayName });
    await logOperation({
      user,
      request,
      action: "SALES_RETURN_CREATE",
      targetType: "SALES_RETURN_ORDER",
      targetId: result.orderId,
      result: "SUCCESS",
      detail: `barcodes=${result.items.length}`
    });
    return ok(result, { status: 201 });
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "SALES_RETURN_CREATE",
      targetType: "SALES_RETURN_ORDER",
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
