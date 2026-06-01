import { getPrisma } from "@/lib/db";
import { formatAppDateTime } from "@/lib/warehouse-utils";
import type { ManagedUser, UserRoleCode } from "@/lib/types";

export type CreateUserInput = {
  username: string;
  displayName: string;
  password: string;
  roleCode: UserRoleCode;
};

export async function listUsers(): Promise<ManagedUser[]> {
  const prisma = getPrisma();
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: { roles: { include: { role: true } } }
  });

  return users.map((user) => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    status: user.status === "ENABLED" ? "enabled" : "disabled",
    createdAt: formatAppDateTime(user.createdAt),
    roles: user.roles
      .filter((entry) => entry.role.status === "ENABLED" && isRoleCode(entry.role.code))
      .map((entry) => ({ code: entry.role.code as UserRoleCode, name: entry.role.name }))
  }));
}

export async function createUser(input: CreateUserInput): Promise<ManagedUser> {
  const username = input.username.trim();
  const displayName = input.displayName.trim();
  const password = input.password.trim();

  if (!username || !displayName || !password) {
    throw new Error("请完整填写账号、姓名和密码");
  }
  if (!isRoleCode(input.roleCode)) {
    throw new Error("请选择有效角色");
  }

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.findUnique({ where: { code: input.roleCode } });
    if (!role || role.status !== "ENABLED") throw new Error("请选择启用状态的角色");

    const user = await tx.user.create({
      data: {
        username,
        displayName,
        passwordHash: password,
        status: "ENABLED"
      }
    });

    await tx.userRole.create({
      data: {
        userId: user.id,
        roleId: role.id
      }
    });

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      status: "enabled",
      createdAt: formatAppDateTime(user.createdAt),
      roles: [{ code: input.roleCode, name: role.name }]
    };
  });
}

function isRoleCode(code: string): code is UserRoleCode {
  return code === "SUPER_ADMIN" || code === "WAREHOUSE_ADMIN" || code === "INVENTORY_VIEWER";
}
