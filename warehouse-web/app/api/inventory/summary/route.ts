import { fail, ok } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-permissions";
import { getInventorySummary } from "@/lib/services/inventory-query-service";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    return ok(await getInventorySummary());
  } catch (error) {
    return fail(error);
  }
}
