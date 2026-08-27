import { fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed } from "@/lib/auth-permissions";
import { heartbeatTrackingBarcodeReservations } from "@/lib/services/tracking-reservation-service";

export async function POST(request: Request) {
  try {
    const user = await assertWarehouseOperationAllowed(request);
    const input = (await request.json()) as { sessionId: string; barcodes: string[] };
    return ok(await heartbeatTrackingBarcodeReservations({ ...input, userId: user.id }));
  } catch (error) {
    return fail(error, 400);
  }
}
