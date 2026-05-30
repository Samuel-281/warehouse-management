import { fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed } from "@/lib/auth-permissions";
import { submitSalesReturn, type SubmitSalesReturnInput } from "@/lib/services/sales-return-service";

export async function POST(request: Request) {
  try {
    const user = await assertWarehouseOperationAllowed(request);
    const input = (await request.json()) as SubmitSalesReturnInput;
    return ok(await submitSalesReturn({ ...input, operatorName: user.displayName }), { status: 201 });
  } catch (error) {
    return fail(error, 400);
  }
}
