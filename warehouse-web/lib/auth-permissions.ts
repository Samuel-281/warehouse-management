import { ApiError } from "@/lib/api-response";
import { getCurrentUserBySessionToken } from "@/lib/services/auth-service";
import { hasAnyRole } from "@/lib/role-utils";
import type { CurrentUser } from "@/lib/types";

export const sessionCookieName = "warehouse_session";

export async function currentUserFromRequest(request: Request): Promise<CurrentUser | null> {
  const token = sessionTokenFromRequest(request);
  if (!token) return null;
  return getCurrentUserBySessionToken(token);
}

export function sessionTokenFromRequest(request: Request) {
  return readCookie(request, sessionCookieName);
}

export async function assertSuperAdminAllowed(request: Request): Promise<CurrentUser> {
  const user = await requireCurrentUser(request);
  if (!hasAnyRole(user.roles.map((role) => role.code), ["SUPER_ADMIN"])) {
    throw new ApiError("当前账号无权执行系统维护操作", 403);
  }

  return user;
}

export async function requireCurrentUser(request: Request): Promise<CurrentUser> {
  const user = await currentUserFromRequest(request);
  if (!user) {
    throw new ApiError("请先登录", 401);
  }

  return user;
}

export async function assertWarehouseOperationAllowed(request: Request): Promise<CurrentUser> {
  const user = await requireCurrentUser(request);
  if (!hasAnyRole(user.roles.map((role) => role.code), ["SUPER_ADMIN", "WAREHOUSE_ADMIN"])) {
    throw new ApiError("当前账号无权执行仓库业务操作", 403);
  }

  return user;
}

export async function assertMasterDataAllowed(request: Request): Promise<CurrentUser> {
  const user = await requireCurrentUser(request);
  if (!hasAnyRole(user.roles.map((role) => role.code), ["SUPER_ADMIN", "WAREHOUSE_ADMIN"])) {
    throw new ApiError("当前账号无权维护基础资料", 403);
  }

  return user;
}

function readCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie");
  if (!cookies) return null;

  return (
    cookies
      .split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? null
  );
}
