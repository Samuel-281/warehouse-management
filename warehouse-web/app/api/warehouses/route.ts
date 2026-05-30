import { fail, ok } from "@/lib/api-response";
import { assertMasterDataAllowed } from "@/lib/auth-permissions";
import {
  createBranchWarehouse,
  type CreateWarehouseInput
} from "@/lib/services/master-data-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function POST(request: Request) {
  let user = null;
  try {
    user = await assertMasterDataAllowed(request);
    const input = (await request.json()) as CreateWarehouseInput;
    const result = await createBranchWarehouse(input);
    await logOperation({ user, request, action: "MASTER_WAREHOUSE_CREATE", targetType: "WAREHOUSE", targetId: result.warehouse.id, result: "SUCCESS" });
    return ok(result, { status: 201 });
  } catch (error) {
    await logOperation({ user, request, action: "MASTER_WAREHOUSE_CREATE", targetType: "WAREHOUSE", result: "FAILURE", detail: error instanceof Error ? error.message : undefined });
    return fail(error, 400);
  }
}
