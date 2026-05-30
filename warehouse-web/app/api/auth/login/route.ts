import { fail, ok } from "@/lib/api-response";
import { sessionCookieName } from "@/lib/auth-permissions";
import { login, type LoginInput } from "@/lib/services/auth-service";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as LoginInput;
    const result = await login(input);
    const response = ok(result.user);
    response.cookies.set(sessionCookieName, result.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expires: result.expiresAt
    });

    return response;
  } catch (error) {
    return fail(error, 401);
  }
}
