import { fail, ok } from "@/lib/api-response";
import {
  createBranchWarehouse,
  type CreateWarehouseInput
} from "@/lib/services/master-data-service";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as CreateWarehouseInput;
    return ok(await createBranchWarehouse(input), { status: 201 });
  } catch (error) {
    return fail(error, 400);
  }
}
