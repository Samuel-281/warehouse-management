import { fail, ok } from "@/lib/api-response";
import { sessionCookieName } from "@/lib/auth-permissions";
import { login, type LoginInput } from "@/lib/services/auth-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function POST(request: Request) {
  let input: LoginInput | null = null;
  try {
    input = (await request.json()) as LoginInput;
    const result = await login(input);
    const response = ok(result.user);
    response.cookies.set(sessionCookieName, result.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
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
