import type { UserRoleCode } from "@/lib/types";

const roleHeader = "x-warehouse-roles";

export function roleHeaderValue(roles: UserRoleCode[]) {
  return roles.join(",");
}

export function rolesFromRequest(request: Request): UserRoleCode[] {
  return request.headers
    .get(roleHeader)
    ?.split(",")
    .map((role) => role.trim())
    .filter(isRoleCode) ?? [];
}

export function assertWarehouseOperationAllowed(request: Request) {
  const roles = rolesFromRequest(request);
  if (!hasAnyRole(roles, ["SUPER_ADMIN", "WAREHOUSE_ADMIN"])) {
    throw new Error("当前账号无权执行仓库业务操作");
  }
}

export function assertMasterDataAllowed(request: Request) {
  const roles = rolesFromRequest(request);
  if (!hasAnyRole(roles, ["SUPER_ADMIN", "WAREHOUSE_ADMIN"])) {
    throw new Error("当前账号无权维护基础资料");
  }
}

export function hasAnyRole(current: UserRoleCode[], allowed: UserRoleCode[]) {
  return current.some((role) => allowed.includes(role));
}

function isRoleCode(code: string): code is UserRoleCode {
  return code === "SUPER_ADMIN" || code === "WAREHOUSE_ADMIN" || code === "INVENTORY_VIEWER";
}
