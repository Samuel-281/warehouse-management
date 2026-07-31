import { fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed, requireCurrentUser } from "@/lib/auth-permissions";
import { logOperation } from "@/lib/services/operation-log-service";
import {
  dissolveTrackingOrderGroup,
  getTrackingOrderGroupDetail
} from "@/lib/services/tracking-order-group-service";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireCurrentUser(request);
    const { id } = await context.params;
    return ok(await getTrackingOrderGroupDetail(id));
  } catch (error) {
    return fail(error, 404);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  let user = null;
  try {
    user = await assertWarehouseOperationAllowed(request);
    const { id } = await context.params;
    const group = await dissolveTrackingOrderGroup(id);
    await logOperation({
      user,
      request,
      action: "TRACKING_ORDER_GROUP_DISSOLVE",
      targetType: "TRACKING_ORDER_GROUP",
      targetId: id,
      result: "SUCCESS",
      detail: `groupNo=${group.groupNo};orders=${group.orderCount}`
    });
    return ok(group);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "TRACKING_ORDER_GROUP_DISSOLVE",
      targetType: "TRACKING_ORDER_GROUP",
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
