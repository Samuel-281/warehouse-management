import { fail, ok } from "@/lib/api-response";
import { assertSuperAdminAllowed, requireCurrentUser } from "@/lib/auth-permissions";
import { logOperation } from "@/lib/services/operation-log-service";
import { deleteOrders, listOrderSummaries, type DeleteOrderInput } from "@/lib/services/order-service";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    return ok(await listOrderSummaries());
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  let user = null;
  try {
    user = await assertSuperAdminAllowed(request);
    const input = (await request.json()) as { orders?: DeleteOrderInput[] };
    const result = await deleteOrders(input.orders ?? []);
    await logOperation({
      user,
      request,
      action: "ORDERS_DELETE",
      targetType: "ORDER",
      result: "SUCCESS",
      detail: `deleted=${result.deleted}`
    });
    return ok(result);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "ORDERS_DELETE",
      targetType: "ORDER",
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
