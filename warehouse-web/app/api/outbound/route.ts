import { fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed } from "@/lib/auth-permissions";
import { splitIdempotencyMetadata } from "@/lib/services/idempotency-service";
import { submitOutbound, type SubmitOutboundInput } from "@/lib/services/outbound-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function POST(request: Request) {
  let user = null;
  try {
    user = await assertWarehouseOperationAllowed(request);
    const input = (await request.json()) as SubmitOutboundInput;
    const result = await submitOutbound({ ...input, operatorName: user.displayName, operatorUserId: user.id });
    const { data, idempotentReplay } = splitIdempotencyMetadata(result);
    await logOperation({
      user,
      request,
      action: "OUTBOUND_CREATE",
      targetType: "OUTBOUND_ORDER",
      targetId: data.orderId,
      result: "SUCCESS",
      detail: `lines=${input.lines?.length ?? 1};barcodes=${data.items.length};replay=${idempotentReplay}`
    });
    return ok(data, {
      status: idempotentReplay ? 200 : 201,
      headers: idempotentReplay ? { "X-Idempotent-Replay": "true" } : undefined
    });
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "OUTBOUND_CREATE",
      targetType: "OUTBOUND_ORDER",
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
