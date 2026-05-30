import { fail, ok } from "@/lib/api-response";
import { assertMasterDataAllowed } from "@/lib/auth-permissions";
import { updateGoods, type UpdateGoodsInput } from "@/lib/services/master-data-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let user = null;
  const { id } = await params;
  try {
    user = await assertMasterDataAllowed(request);
    const input = (await request.json()) as UpdateGoodsInput;
    const result = await updateGoods(id, input);
    await logOperation({
      user,
      request,
      action: input.status ? "MASTER_GOODS_STATUS_UPDATE" : "MASTER_GOODS_UPDATE",
      targetType: "GOODS",
      targetId: result.id,
      result: "SUCCESS"
    });
    return ok(result);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "MASTER_GOODS_UPDATE",
      targetType: "GOODS",
      targetId: id,
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
