import { fail, ok } from "@/lib/api-response";
import { createGoods, type CreateGoodsInput } from "@/lib/services/master-data-service";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as CreateGoodsInput;
    return ok(await createGoods(input), { status: 201 });
  } catch (error) {
    return fail(error, 400);
  }
}
