import { fail, ok } from "@/lib/api-response";
import { assertSuperAdminAllowed, requireCurrentUser } from "@/lib/auth-permissions";
import { deleteInventoryItemByBarcode, getInventoryDetail } from "@/lib/services/inventory-query-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function GET(request: Request, { params }: { params: Promise<{ barcode: string }> }) {
  try {
    await requireCurrentUser(request);
    const { barcode } = await params;
    return ok(await getInventoryDetail(decodeURIComponent(barcode)));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ barcode: string }> }) {
  let user = null;
  const { barcode } = await params;
  const decodedBarcode = decodeURIComponent(barcode);
  try {
    user = await assertSuperAdminAllowed(request);
    const result = await deleteInventoryItemByBarcode(decodedBarcode);
    await logOperation({
      user,
      request,
      action: "INVENTORY_ITEM_DELETE",
      targetType: "INVENTORY_ITEM",
      targetId: decodedBarcode,
      result: "SUCCESS"
    });
    return ok(result);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "INVENTORY_ITEM_DELETE",
      targetType: "INVENTORY_ITEM",
      targetId: decodedBarcode,
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
