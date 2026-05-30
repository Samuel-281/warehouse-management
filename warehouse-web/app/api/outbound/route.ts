import { fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed } from "@/lib/auth-permissions";
import { submitOutbound, type SubmitOutboundInput } from "@/lib/services/outbound-service";

export async function POST(request: Request) {
  try {
    const user = await assertWarehouseOperationAllowed(request);
    const input = (await request.json()) as SubmitOutboundInput;
    return ok(await submitOutbound({ ...input, operatorName: user.displayName }), { status: 201 });
  } catch (error) {
    return fail(error, 400);
  }
}
