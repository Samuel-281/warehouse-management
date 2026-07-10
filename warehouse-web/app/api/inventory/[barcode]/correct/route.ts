import { fail, ok } from "@/lib/api-response";
import { assertSuperAdminAllowed } from "@/lib/auth-permissions";
import { correctBarcode } from "@/lib/services/barcode-management-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ barcode: string }> }) {
  let user = null;
  const { barcode } = await params;
  const decodedBarcode = decodeURIComponent(barcode);
  try {
    user = await assertSuperAdminAllowed(request);
    const input = (await request.json()) as { newBarcode?: string; reason?: string };
    const result = await correctBarcode({
      barcode: decodedBarcode,
      newBarcode: input.newBarcode ?? "",
      reason: input.reason ?? "",
      operatorName: user.displayName
    });
    await logOperation({
      user,
      request,
      action: "BARCODE_CORRECT",
      targetType: "INVENTORY_ITEM",
      targetId: decodedBarcode,
      result: "SUCCESS",
      detail: `newBarcode=${result.barcode};reason=${input.reason?.trim() ?? ""}`
    });
    return ok(result);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "BARCODE_CORRECT",
      targetType: "INVENTORY_ITEM",
      targetId: decodedBarcode,
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
