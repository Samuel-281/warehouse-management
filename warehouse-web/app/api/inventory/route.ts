import { fail, ok } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-permissions";
import { listInventory } from "@/lib/services/inventory-query-service";
import type { InventoryStatusScope } from "@/lib/types";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    const url = new URL(request.url);
    return ok(
      await listInventory({
        keyword: url.searchParams.get("keyword") ?? "",
        statusScope: (url.searchParams.get("statusScope") ?? "active") as InventoryStatusScope,
        ownerScope: (url.searchParams.get("ownerScope") ?? "all") as "all" | "warehouse" | "salesperson" | "terminal_store",
        warehouseId: url.searchParams.get("warehouseId") ?? "all",
        salespersonId: url.searchParams.get("salespersonId") ?? "all",
        goodsId: url.searchParams.get("goodsId") ?? "all",
        page: Number(url.searchParams.get("page") ?? "1"),
        pageSize: Number(url.searchParams.get("pageSize") ?? "20")
      })
    );
  } catch (error) {
    return fail(error);
  }
}
