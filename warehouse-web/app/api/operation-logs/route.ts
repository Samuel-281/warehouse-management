import { fail, ok } from "@/lib/api-response";
import { assertSuperAdminAllowed } from "@/lib/auth-permissions";
import { listOperationLogs } from "@/lib/services/operation-log-service";

export async function GET(request: Request) {
  try {
    await assertSuperAdminAllowed(request);
    return ok(await listOperationLogs());
  } catch (error) {
    return fail(error, 403);
  }
}
