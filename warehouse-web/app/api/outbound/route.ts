import { fail, ok } from "@/lib/api-response";
import { submitOutbound, type SubmitOutboundInput } from "@/lib/services/outbound-service";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as SubmitOutboundInput;
    return ok(await submitOutbound(input), { status: 201 });
  } catch (error) {
    return fail(error, 400);
  }
}
