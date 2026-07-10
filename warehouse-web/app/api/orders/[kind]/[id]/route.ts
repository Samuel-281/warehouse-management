import { fail, ok } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-permissions";
import { getOrderDetail } from "@/lib/services/order-service";
import type { OrderKind } from "@/lib/types";

export async function GET(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  try {
    await requireCurrentUser(request);
    const { kind, id } = await params;
    if (!isOrderKind(kind)) throw new Error("单据类型无效");
    return ok(await getOrderDetail({ id, kind }));
  } catch (error) {
    return fail(error, 400);
  }
}

function isOrderKind(value: string): value is OrderKind {
  return value === "inbound" || value === "outbound" || value === "sales_return";
}
