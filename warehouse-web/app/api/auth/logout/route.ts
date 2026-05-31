import { fail, ok } from "@/lib/api-response";
import { currentUserFromRequest, sessionCookieName, sessionTokenFromRequest } from "@/lib/auth-permissions";
import { deleteSession } from "@/lib/services/auth-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function POST(request: Request) {
  try {
    const user = await currentUserFromRequest(request);
    const token = sessionTokenFromRequest(request);
    if (token) {
      await deleteSession(token);
    }

    await logOperation({
      user,
      request,
      action: "AUTH_LOGOUT",
      targetType: "AUTH",
      result: "SUCCESS"
    });

    const response = ok({ loggedOut: true });
    response.cookies.set(sessionCookieName, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0
    });

    return response;
  } catch (error) {
    return fail(error, 400);
  }
}
