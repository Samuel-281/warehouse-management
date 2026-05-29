import { fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed } from "@/lib/auth-permissions";
import { submitSalesReturn, type SubmitSalesReturnInput } from "@/lib/services/sales-return-service";

export async function POST(request: Request) {
  try {
    assertWarehouseOperationAllowed(request);
    const input = (await request.json()) as SubmitSalesReturnInput;
    return ok(await submitSalesReturn(input), { status: 201 });
  } catch (error) {
    return fail(error, 400);
  }
}
