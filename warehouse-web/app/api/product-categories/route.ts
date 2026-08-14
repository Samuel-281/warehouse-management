import { fail, ok } from "@/lib/api-response";
import { assertMasterDataAllowed, requireCurrentUser } from "@/lib/auth-permissions";
import { createProductCategory, listProductCategories } from "@/lib/services/product-category-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    const { searchParams } = new URL(request.url);
    return ok(await listProductCategories({ status: searchParams.get("status") ?? undefined }));
  } catch (error) {
    return fail(error, 400);
  }
}

export async function POST(request: Request) {
  let user = null;
  try {
    user = await assertMasterDataAllowed(request);
    const input = (await request.json()) as { name?: string };
    const category = await createProductCategory(input.name ?? "");
    await logOperation({
      user,
      request,
      action: "PRODUCT_CATEGORY_CREATE",
      targetType: "PRODUCT_CATEGORY",
      targetId: category.id,
      result: "SUCCESS",
      detail: `名称：${category.name}`
    });
    return ok(category, { status: 201 });
  } catch (error) {
    await logOperation({ user, request, action: "PRODUCT_CATEGORY_CREATE", targetType: "PRODUCT_CATEGORY", result: "FAILURE", detail: error instanceof Error ? error.message : undefined });
    return fail(error, 400);
  }
}
