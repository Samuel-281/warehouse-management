import type { UserRoleCode } from "@/lib/types";

export function hasAnyRole(current: UserRoleCode[], allowed: UserRoleCode[]) {
  return current.some((role) => allowed.includes(role));
}
