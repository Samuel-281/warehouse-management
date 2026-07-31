import { fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed, requireCurrentUser } from "@/lib/auth-permissions";
import { logOperation } from "@/lib/services/operation-log-service";
import {
  createTrackingOrderGroup,
  listTrackingOrderGroups
} from "@/lib/services/tracking-order-group-service";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    const { searchParams } = new URL(request.url);
    return ok(await listTrackingOrderGroups({
      page: Number(searchParams.get("page") || 1),
      pageSize: Number(searchParams.get("pageSize") || 20)
    }));
  } catch (error) {
    return fail(error, 400);
  }
}

export async function POST(request: Request) {
  let user = null;
  try {
    user = await assertWarehouseOperationAllowed(request);
    const input = (await request.json()) as { orderIds?: string[] };
    const group = await createTrackingOrderGroup({
      orderIds: input.orderIds ?? [],
      operatorName: user.displayName,
      operatorUserId: user.id
    });
    await logOperation({
      user,
      request,
      action: "TRACKING_ORDER_GROUP_CREATE",
      targetType: "TRACKING_ORDER_GROUP",
      targetId: group.id,
      result: "SUCCESS",
      detail: `groupNo=${group.groupNo};orders=${group.orderCount};barcodes=${group.barcodeCount}`
    });
    return ok(group, { status: 201 });
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "TRACKING_ORDER_GROUP_CREATE",
      targetType: "TRACKING_ORDER_GROUP",
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
