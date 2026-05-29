import { fail, ok } from "@/lib/api-response";
import { listMasterData } from "@/lib/services/master-data-service";

export async function GET() {
  try {
    return ok(await listMasterData());
  } catch (error) {
    return fail(error);
  }
}
