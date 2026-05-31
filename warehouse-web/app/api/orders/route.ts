import { fail, ok } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-permissions";
import { listOrderSummaries } from "@/lib/services/order-service";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    return ok(await listOrderSummaries());
  } catch (error) {
    return fail(error);
  }
}
