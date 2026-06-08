import { fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed } from "@/lib/auth-permissions";
import { submitInbound, type SubmitInboundInput } from "@/lib/services/inbound-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function POST(request: Request) {
  let user = null;
  try {
    user = await assertWarehouseOperationAllowed(request);
    const input = (await request.json()) as SubmitInboundInput;
    const result = await submitInbound({ ...input, operatorName: user.displayName });
    await logOperation({
      user,
      request,
      action: "INBOUND_CREATE",
      targetType: "INBOUND_ORDER",
      targetId: result.orderId,
      result: "SUCCESS",
      detail: `quantity=${result.quantity ?? result.items.length};barcodes=${result.items.length}`
    });
    return ok(result, { status: 201 });
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "INBOUND_CREATE",
      targetType: "INBOUND_ORDER",
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
