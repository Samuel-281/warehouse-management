import { fail, ok } from "@/lib/api-response";
import { assertSuperAdminAllowed } from "@/lib/auth-permissions";
import { logOperation } from "@/lib/services/operation-log-service";
import { resetUserPassword } from "@/lib/services/user-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let user = null;
  let targetId: string | undefined;
  try {
    user = await assertSuperAdminAllowed(request);
    targetId = (await context.params).id;
    const input = (await request.json()) as { password?: string };
    const result = await resetUserPassword(targetId, input.password ?? "", user.id);
    await logOperation({
      user,
      request,
      action: "USER_RESET_PASSWORD",
      targetType: "USER",
      targetId,
      result: "SUCCESS"
    });
    return ok(result);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "USER_RESET_PASSWORD",
      targetType: "USER",
      targetId,
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
