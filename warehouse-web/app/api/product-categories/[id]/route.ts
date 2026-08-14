import { fail, ok } from "@/lib/api-response";
import { assertMasterDataAllowed } from "@/lib/auth-permissions";
import { setProductCategoryStatus } from "@/lib/services/product-category-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  let user = null;
  const { id } = await context.params;
  try {
    user = await assertMasterDataAllowed(request);
    const input = (await request.json()) as { status?: string };
    const category = await setProductCategoryStatus(id, input.status ?? "");
    await logOperation({
      user,
      request,
      action: category.status === "enabled" ? "PRODUCT_CATEGORY_RESTORE" : "PRODUCT_CATEGORY_DISABLE",
      targetType: "PRODUCT_CATEGORY",
      targetId: id,
      result: "SUCCESS",
      detail: `名称：${category.name}`
    });
    return ok(category);
  } catch (error) {
    await logOperation({ user, request, action: "PRODUCT_CATEGORY_STATUS_UPDATE", targetType: "PRODUCT_CATEGORY", targetId: id, result: "FAILURE", detail: error instanceof Error ? error.message : undefined });
    return fail(error, 400);
  }
}
