import { fail, ok } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-permissions";
import { listTrackingReviewTargets } from "@/lib/services/tracking-review-service";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    const { searchParams } = new URL(request.url);
    return ok(await listTrackingReviewTargets({
      status: searchParams.get("status") ?? undefined,
      page: Number(searchParams.get("page") || 1),
      pageSize: Number(searchParams.get("pageSize") || 20)
    }));
  } catch (error) {
    return fail(error, 400);
  }
}
