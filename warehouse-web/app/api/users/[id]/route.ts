import { fail, ok } from "@/lib/api-response";
import { assertSuperAdminAllowed } from "@/lib/auth-permissions";
import { logOperation } from "@/lib/services/operation-log-service";
import { updateUser, type UpdateUserInput } from "@/lib/services/user-service";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  let user = null;
  let targetId: string | undefined;
  try {
    user = await assertSuperAdminAllowed(request);
    targetId = (await context.params).id;
    const input = (await request.json()) as UpdateUserInput;
    const result = await updateUser(targetId, input, user.id);
    await logOperation({
      user,
      request,
      action: "USER_UPDATE",
      targetType: "USER",
      targetId,
      result: "SUCCESS",
      detail: `status=${result.status};roles=${result.roles.map((role) => role.code).join(",")}`
    });
    return ok(result);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "USER_UPDATE",
      targetType: "USER",
      targetId,
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
