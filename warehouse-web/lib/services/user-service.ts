import { getPrisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { formatAppDateTime } from "@/lib/warehouse-utils";
import type { ManagedUser, UserRoleCode } from "@/lib/types";

type DbRole = {
  role: {
    id?: string;
    code: string;
    name: string;
    status: "ENABLED" | "DISABLED";
  };
};

export type CreateUserInput = {
  username: string;
  displayName: string;
  password: string;
  roleCode: UserRoleCode;
};

export type UpdateUserInput = {
  displayName: string;
  roleCode: UserRoleCode;
  status: "enabled" | "disabled";
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
  if (password.length < 8) {
    throw new Error("密码至少需要 8 个字符");
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
        passwordHash: await hashPassword(password),
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

export async function updateUser(userId: string, input: UpdateUserInput, currentUserId: string): Promise<ManagedUser> {
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("显示姓名不能为空");
  if (!isRoleCode(input.roleCode)) throw new Error("请选择有效角色");
  if (input.status !== "enabled" && input.status !== "disabled") throw new Error("请选择有效账号状态");

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } }
    });
    if (!target) throw new Error("账号不存在");

    const targetIsSuperAdmin = target.roles.some(
      (entry) => entry.role.code === "SUPER_ADMIN" && entry.role.status === "ENABLED"
    );
    const removesSuperAdmin = input.roleCode !== "SUPER_ADMIN" || input.status === "disabled";
    if (target.id === currentUserId && removesSuperAdmin) {
      throw new Error("不能停用或降级当前登录的超级管理员账号");
    }
    if (targetIsSuperAdmin && removesSuperAdmin) {
      const enabledSuperAdmins = await tx.user.count({
        where: {
          status: "ENABLED",
          roles: { some: { role: { code: "SUPER_ADMIN", status: "ENABLED" } } }
        }
      });
      if (enabledSuperAdmins <= 1) throw new Error("系统必须保留至少一个启用的超级管理员");
    }

    const role = await tx.role.findUnique({ where: { code: input.roleCode } });
    if (!role || role.status !== "ENABLED") throw new Error("请选择启用状态的角色");

    const roleChanged = target.roles.length !== 1 || target.roles[0]?.roleId !== role.id;
    const status = input.status === "enabled" ? "ENABLED" : "DISABLED";
    const statusChanged = target.status !== status;
    const user = await tx.user.update({
      where: { id: target.id },
      data: { displayName, status }
    });
    if (roleChanged) {
      await tx.userRole.deleteMany({ where: { userId: target.id } });
      await tx.userRole.create({ data: { userId: target.id, roleId: role.id } });
    }
    if (roleChanged || statusChanged) {
      await tx.userSession.deleteMany({ where: { userId: target.id } });
    }

    return mapManagedUser(user, [{ role }]);
  });
}

export async function resetUserPassword(userId: string, password: string, currentUserId: string) {
  if (userId === currentUserId) throw new Error("请使用“修改密码”功能修改当前账号密码");
  const normalizedPassword = validateNewPassword(password);
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId } });
    if (!target) throw new Error("账号不存在");
    await tx.user.update({
      where: { id: target.id },
      data: { passwordHash: await hashPassword(normalizedPassword) }
    });
    await tx.userSession.deleteMany({ where: { userId: target.id } });
    return { reset: true };
  });
}

export async function changeOwnPassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  currentSessionToken: string;
}) {
  const currentPassword = input.currentPassword.trim();
  const newPassword = validateNewPassword(input.newPassword);
  if (currentPassword === newPassword) throw new Error("新密码不能与当前密码相同");

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new Error("当前密码不正确");
    }
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) }
    });
    await tx.userSession.deleteMany({
      where: { userId: user.id, token: { not: input.currentSessionToken } }
    });
    return { changed: true };
  });
}

function mapManagedUser(
  user: { id: string; username: string; displayName: string; status: "ENABLED" | "DISABLED"; createdAt: Date },
  roles: DbRole[]
): ManagedUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    status: user.status === "ENABLED" ? "enabled" : "disabled",
    createdAt: formatAppDateTime(user.createdAt),
    roles: roles
      .filter((entry) => entry.role.status === "ENABLED" && isRoleCode(entry.role.code))
      .map((entry) => ({ code: entry.role.code as UserRoleCode, name: entry.role.name }))
  };
}

function validateNewPassword(password: string) {
  const value = password.trim();
  if (value.length < 8) throw new Error("密码至少需要 8 个字符");
  if (value.length > 128) throw new Error("密码不能超过 128 个字符");
  return value;
}

function isRoleCode(code: string): code is UserRoleCode {
  return code === "SUPER_ADMIN" || code === "WAREHOUSE_ADMIN" || code === "INVENTORY_VIEWER";
}
