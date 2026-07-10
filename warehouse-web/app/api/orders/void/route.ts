import { fail, ok } from "@/lib/api-response";
import { assertSuperAdminAllowed } from "@/lib/auth-permissions";
import { logOperation } from "@/lib/services/operation-log-service";
import { voidOrders, type VoidOrderReference } from "@/lib/services/order-reversal-service";

export async function POST(request: Request) {
  let user = null;
  try {
    user = await assertSuperAdminAllowed(request);
    const input = (await request.json()) as { orders?: VoidOrderReference[]; reason?: string };
    const result = await voidOrders({ orders: input.orders ?? [], reason: input.reason ?? "", user });
    await logOperation({
      user,
      request,
      action: "ORDERS_VOID",
      targetType: "ORDER",
      result: "SUCCESS",
      detail: `voided=${result.voided};reason=${input.reason?.trim() ?? ""}`
    });
    return ok(result);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "ORDERS_VOID",
      targetType: "ORDER",
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
