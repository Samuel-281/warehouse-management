import { fail, ok } from "@/lib/api-response";
import { assertSuperAdminAllowed } from "@/lib/auth-permissions";
import { logOperation } from "@/lib/services/operation-log-service";
import { createUser, listUsers, type CreateUserInput } from "@/lib/services/user-service";

export async function GET(request: Request) {
  try {
    await assertSuperAdminAllowed(request);
    return ok(await listUsers());
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  let user = null;
  try {
    user = await assertSuperAdminAllowed(request);
    const input = (await request.json()) as CreateUserInput;
    const result = await createUser(input);
    await logOperation({
      user,
      request,
      action: "USER_CREATE",
      targetType: "USER",
      targetId: result.id,
      result: "SUCCESS",
      detail: `username=${result.username}`
    });
    return ok(result, { status: 201 });
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "USER_CREATE",
      targetType: "USER",
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
