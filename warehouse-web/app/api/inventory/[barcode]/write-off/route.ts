import { fail, ok } from "@/lib/api-response";
import { assertSuperAdminAllowed } from "@/lib/auth-permissions";
import { writeOffBarcode } from "@/lib/services/barcode-management-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function POST(request: Request, { params }: { params: Promise<{ barcode: string }> }) {
  let user = null;
  const { barcode } = await params;
  const decodedBarcode = decodeURIComponent(barcode);
  try {
    user = await assertSuperAdminAllowed(request);
    const input = (await request.json()) as { reason?: string };
    const result = await writeOffBarcode({
      barcode: decodedBarcode,
      reason: input.reason ?? "",
      operatorName: user.displayName
    });
    await logOperation({
      user,
      request,
      action: "INVENTORY_ITEM_WRITE_OFF",
      targetType: "INVENTORY_ITEM",
      targetId: decodedBarcode,
      result: "SUCCESS",
      detail: `reason=${input.reason?.trim() ?? ""}`
    });
    return ok(result);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "INVENTORY_ITEM_WRITE_OFF",
      targetType: "INVENTORY_ITEM",
      targetId: decodedBarcode,
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
