import { fail, ok } from "@/lib/api-response";
import { assertMasterDataAllowed } from "@/lib/auth-permissions";
import {
  createBranchWarehouse,
  type CreateWarehouseInput
} from "@/lib/services/master-data-service";

export async function POST(request: Request) {
  try {
    await assertMasterDataAllowed(request);
    const input = (await request.json()) as CreateWarehouseInput;
    return ok(await createBranchWarehouse(input), { status: 201 });
  } catch (error) {
    return fail(error, 400);
  }
}
