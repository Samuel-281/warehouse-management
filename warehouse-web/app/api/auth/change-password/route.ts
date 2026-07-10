import { fail, ok } from "@/lib/api-response";
import { requireCurrentUser, sessionTokenFromRequest } from "@/lib/auth-permissions";
import { logOperation } from "@/lib/services/operation-log-service";
import { changeOwnPassword } from "@/lib/services/user-service";

type ChangePasswordInput = {
  currentPassword?: string;
  newPassword?: string;
};

export async function POST(request: Request) {
  let user = null;
  try {
    user = await requireCurrentUser(request);
    const token = sessionTokenFromRequest(request);
    if (!token) throw new Error("登录状态已失效，请重新登录");
    const input = (await request.json()) as ChangePasswordInput;
    const result = await changeOwnPassword({
      userId: user.id,
      currentPassword: input.currentPassword ?? "",
      newPassword: input.newPassword ?? "",
      currentSessionToken: token
    });
    await logOperation({
      user,
      request,
      action: "USER_CHANGE_PASSWORD",
      targetType: "USER",
      targetId: user.id,
      result: "SUCCESS"
    });
    return ok(result);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "USER_CHANGE_PASSWORD",
      targetType: "USER",
      targetId: user?.id,
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
