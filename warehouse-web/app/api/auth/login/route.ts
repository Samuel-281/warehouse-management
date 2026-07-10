import { fail, ok } from "@/lib/api-response";
import { sessionCookieName } from "@/lib/auth-permissions";
import { login, type LoginInput } from "@/lib/services/auth-service";
import { logOperation } from "@/lib/services/operation-log-service";
import { shouldUseSecureSessionCookie } from "@/lib/session-cookie";
import { assertLoginAllowed, clearLoginFailures, loginAttemptKey, recordLoginFailure } from "@/lib/login-rate-limit";

export async function POST(request: Request) {
  let input: LoginInput | null = null;
  let attemptKey = "";
  try {
    input = (await request.json()) as LoginInput;
    attemptKey = loginAttemptKey(request, input.username ?? "");
    assertLoginAllowed(attemptKey);
    const result = await login(input);
    clearLoginFailures(attemptKey);
    const response = ok(result.user);
    response.cookies.set(sessionCookieName, result.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: shouldUseSecureSessionCookie(),
      expires: result.expiresAt
    });
    await logOperation({
      user: result.user,
      request,
      action: "AUTH_LOGIN",
      targetType: "AUTH",
      result: "SUCCESS"
    });

    return response;
  } catch (error) {
    if (attemptKey) recordLoginFailure(attemptKey);
    await logOperation({
      request,
      action: "AUTH_LOGIN",
      targetType: "AUTH",
      result: "FAILURE",
      detail: input?.username ? `username=${input.username}` : undefined
    });
    return fail(error, 401);
  }
}
