import { fail, ok } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-permissions";
import { listTrackingOrders } from "@/lib/services/tracking-service";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    const { searchParams } = new URL(request.url);
    return ok(await listTrackingOrders({
      type: searchParams.get("type") ?? undefined,
      page: Number(searchParams.get("page") || 1),
      pageSize: Number(searchParams.get("pageSize") || 20)
    }));
  } catch (error) {
    return fail(error, 400);
  }
}
