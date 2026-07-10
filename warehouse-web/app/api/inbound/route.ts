import { fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed } from "@/lib/auth-permissions";
import { splitIdempotencyMetadata } from "@/lib/services/idempotency-service";
import { submitInbound, type SubmitInboundInput } from "@/lib/services/inbound-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function POST(request: Request) {
  let user = null;
  try {
    user = await assertWarehouseOperationAllowed(request);
    const input = (await request.json()) as SubmitInboundInput;
    const result = await submitInbound({ ...input, operatorName: user.displayName, operatorUserId: user.id });
    const { data, idempotentReplay } = splitIdempotencyMetadata(result);
    await logOperation({
      user,
      request,
      action: "INBOUND_CREATE",
      targetType: "INBOUND_ORDER",
      targetId: data.orderId,
      result: "SUCCESS",
      detail: `quantity=${data.quantity ?? data.items.length};barcodes=${data.items.length};replay=${idempotentReplay}`
    });
    return ok(data, {
      status: idempotentReplay ? 200 : 201,
      headers: idempotentReplay ? { "X-Idempotent-Replay": "true" } : undefined
    });
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
