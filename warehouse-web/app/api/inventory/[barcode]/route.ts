import { fail, ok } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-permissions";
import { getInventoryDetail } from "@/lib/services/inventory-query-service";

export async function GET(request: Request, { params }: { params: Promise<{ barcode: string }> }) {
  try {
    await requireCurrentUser(request);
    const { barcode } = await params;
    return ok(await getInventoryDetail(decodeURIComponent(barcode)));
  } catch (error) {
    return fail(error);
  }
}
