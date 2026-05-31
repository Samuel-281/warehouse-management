import { fail, ok } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-permissions";

export async function GET(request: Request) {
  try {
    return ok(await requireCurrentUser(request));
  } catch (error) {
    return fail(error);
  }
}
