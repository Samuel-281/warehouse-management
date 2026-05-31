import { fail, ok } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-permissions";
import { listMasterData } from "@/lib/services/master-data-service";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    return ok(await listMasterData());
  } catch (error) {
    return fail(error);
  }
}
