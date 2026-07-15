import { fail, ok } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-permissions";
import { getTrackedBarcodeDetail } from "@/lib/services/tracking-service";

export async function GET(request: Request, context: { params: Promise<{ barcode: string }> }) {
  try {
    await requireCurrentUser(request);
    const { barcode } = await context.params;
    return ok(await getTrackedBarcodeDetail(decodeURIComponent(barcode)));
  } catch (error) {
    return fail(error, 404);
  }
}
