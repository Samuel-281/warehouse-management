import { fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed } from "@/lib/auth-permissions";
import { submitInbound, type SubmitInboundInput } from "@/lib/services/inbound-service";

export async function POST(request: Request) {
  try {
    const user = await assertWarehouseOperationAllowed(request);
    const input = (await request.json()) as SubmitInboundInput;
    return ok(await submitInbound({ ...input, operatorName: user.displayName }), { status: 201 });
  } catch (error) {
    return fail(error, 400);
  }
}
