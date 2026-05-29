import { fail, ok } from "@/lib/api-response";
import {
  createTerminalStore,
  type CreateTerminalStoreInput
} from "@/lib/services/master-data-service";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as CreateTerminalStoreInput;
    return ok(await createTerminalStore(input), { status: 201 });
  } catch (error) {
    return fail(error, 400);
  }
}
