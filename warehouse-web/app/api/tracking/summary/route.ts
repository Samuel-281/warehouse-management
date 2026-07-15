import { fail, ok } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-permissions";
import { getTrackingSummary } from "@/lib/services/tracking-service";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    return ok(await getTrackingSummary());
  } catch (error) {
    return fail(error, 400);
  }
}
