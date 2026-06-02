import { fail, ok } from "@/lib/api-response";
import { assertSuperAdminAllowed, sessionCookieName } from "@/lib/auth-permissions";
import { logOperation } from "@/lib/services/operation-log-service";
import { shouldUseSecureSessionCookie } from "@/lib/session-cookie";
import { resetDemoDatabase } from "@/lib/services/system-maintenance-service";

const confirmationText = "确定重置";

export async function POST(request: Request) {
  let user = null;
  try {
    user = await assertSuperAdminAllowed(request);

    const input = (await request.json()) as { confirmation?: string };
    if (input.confirmation?.trim() !== confirmationText) {
      throw new Error("未输入正确确认文字，已取消重置");
    }

    await resetDemoDatabase();
    await logOperation({
      user,
      request,
      action: "SYSTEM_RESET_DEMO_DATABASE",
      targetType: "SYSTEM",
      result: "SUCCESS",
      detail: "Reset demo database from web maintenance page"
    });

    const response = ok({ reset: true });
    response.cookies.set(sessionCookieName, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: shouldUseSecureSessionCookie(),
      maxAge: 0
    });
    return response;
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "SYSTEM_RESET_DEMO_DATABASE",
      targetType: "SYSTEM",
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
