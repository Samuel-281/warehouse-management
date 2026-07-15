import { fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed } from "@/lib/auth-permissions";
import { validateTrackingBarcodes, type TrackingValidationInput } from "@/lib/services/tracking-service";

export async function POST(request: Request) {
  try {
    await assertWarehouseOperationAllowed(request);
    const input = (await request.json()) as TrackingValidationInput;
    return ok(await validateTrackingBarcodes(input));
  } catch (error) {
    return fail(error, 400);
  }
}
