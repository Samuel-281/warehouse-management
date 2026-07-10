import { fail, ok } from "@/lib/api-response";
import { assertSuperAdminAllowed } from "@/lib/auth-permissions";
import { readBackupStatus } from "@/lib/services/backup-status-service";

export async function GET(request: Request) {
  try {
    await assertSuperAdminAllowed(request);
    return ok(await readBackupStatus());
  } catch (error) {
    return fail(error);
  }
}
