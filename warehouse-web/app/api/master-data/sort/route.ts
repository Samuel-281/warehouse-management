import { fail, ok } from "@/lib/api-response";
import { assertMasterDataAllowed } from "@/lib/auth-permissions";
import { updateMasterSortOrder, type UpdateMasterSortInput } from "@/lib/services/master-data-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function PATCH(request: Request) {
  let user = null;
  try {
    user = await assertMasterDataAllowed(request);
    const input = (await request.json()) as UpdateMasterSortInput;
    const result = await updateMasterSortOrder(input);
    await logOperation({
      user,
      request,
      action: input.target === "goods" ? "MASTER_GOODS_SORT_UPDATE" : "MASTER_WAREHOUSE_SORT_UPDATE",
      targetType: input.target === "goods" ? "GOODS" : "WAREHOUSE",
      result: "SUCCESS",
      detail: `count=${input.orderedIds.length}`
    });
    return ok(result);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "MASTER_SORT_UPDATE",
      targetType: "MASTER_DATA",
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
