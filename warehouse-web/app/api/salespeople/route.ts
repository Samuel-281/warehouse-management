import { fail, ok } from "@/lib/api-response";
import { assertMasterDataAllowed } from "@/lib/auth-permissions";
import {
  createSalesperson,
  type CreateSalespersonInput
} from "@/lib/services/master-data-service";

export async function POST(request: Request) {
  try {
    assertMasterDataAllowed(request);
    const input = (await request.json()) as CreateSalespersonInput;
    return ok(await createSalesperson(input), { status: 201 });
  } catch (error) {
    return fail(error, 400);
  }
}
