import { fail, ok } from "@/lib/api-response";
import { submitInbound, type SubmitInboundInput } from "@/lib/services/inbound-service";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as SubmitInboundInput;
    return ok(await submitInbound(input), { status: 201 });
  } catch (error) {
    return fail(error, 400);
  }
}
