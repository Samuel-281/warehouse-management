import { fail, ok } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-permissions";
import { getTrackingOrderGroupDetail } from "@/lib/services/tracking-order-group-service";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireCurrentUser(request);
    const { id } = await context.params;
    return ok(await getTrackingOrderGroupDetail(id));
  } catch (error) {
    return fail(error, 404);
  }
}
