import { fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed } from "@/lib/auth-permissions";
import { hasAnyRole } from "@/lib/role-utils";
import { logOperation } from "@/lib/services/operation-log-service";
import { saveTrackingReview } from "@/lib/services/tracking-review-service";

export async function POST(request: Request, context: { params: Promise<{ targetType: string; id: string }> }) {
  let user = null;
  const { targetType, id } = await context.params;
  try {
    user = await assertWarehouseOperationAllowed(request);
    if (targetType !== "order" && targetType !== "group") throw new Error("复核目标类型无效");
    const input = (await request.json()) as {
      actualTotalQuantity?: number;
      items?: Array<{ productCategoryId: string; quantity: number }>;
    };
    const review = await saveTrackingReview({
      targetType,
      targetId: id,
      actualTotalQuantity: input.actualTotalQuantity as number,
      items: input.items,
      operatorName: user.displayName,
      operatorUserId: user.id,
      isSuperAdmin: hasAnyRole(user.roles.map((role) => role.code), ["SUPER_ADMIN"])
    });
    await logOperation({
      user,
      request,
      action: review.version === 1 ? "TRACKING_REVIEW_COMPLETE" : "TRACKING_REVIEW_REVISE",
      targetType: targetType === "group" ? "TRACKING_ORDER_GROUP" : "TRACKING_ORDER",
      targetId: id,
      result: "SUCCESS",
      detail: `版本：${review.version}；实际总数：${review.actualTotalQuantity}；有效扫码数：${review.activeBarcodeCount}`
    });
    return ok(review, { status: review.version === 1 ? 201 : 200 });
  } catch (error) {
    await logOperation({ user, request, action: "TRACKING_REVIEW_SAVE", targetType: targetType === "group" ? "TRACKING_ORDER_GROUP" : "TRACKING_ORDER", targetId: id, result: "FAILURE", detail: error instanceof Error ? error.message : undefined });
    return fail(error, 400);
  }
}
