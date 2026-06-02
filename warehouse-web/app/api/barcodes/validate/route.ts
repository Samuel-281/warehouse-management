import { fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed } from "@/lib/auth-permissions";
import { validateBarcodes, type BarcodeValidationInput } from "@/lib/services/inventory-query-service";

export async function POST(request: Request) {
  try {
    await assertWarehouseOperationAllowed(request);
    const input = (await request.json()) as BarcodeValidationInput;
    return ok(await validateBarcodes(input));
  } catch (error) {
    return fail(error);
  }
}
