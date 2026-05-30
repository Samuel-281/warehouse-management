import { randomBytes } from "node:crypto";

import { getPrisma } from "@/lib/db";
import type { CurrentUser, UserRoleCode } from "@/lib/types";

type DbRole = {
  role: {
    code: string;
    name: string;
    status: "ENABLED" | "DISABLED";
  };
};

export type LoginInput = {
  username: string;
  password: string;
};

export type LoginResult = {
  user: CurrentUser;
  sessionToken: string;
  expiresAt: Date;
};

export async function login(input: LoginInput): Promise<LoginResult> {
  const username = input.username.trim();
  const password = input.password.trim();

  if (!username || !password) {
    throw new Error("请输入账号和密码");
  }

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { username },
    include: {
      roles: {
        include: { role: true }
      }
    }
  });

  if (!user || user.status !== "ENABLED" || user.passwordHash !== password) {
    throw new Error("账号或密码不正确");
  }

  const roles = (user.roles as DbRole[])
    .filter((entry) => entry.role.status === "ENABLED" && isRoleCode(entry.role.code))
    .map((entry) => ({
      code: entry.role.code as UserRoleCode,
      name: entry.role.name
    }));

  if (roles.length === 0) {
    throw new Error("当前账号没有可用角色");
  }

  const currentUser = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roles
  };

  const sessionToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12);
  await prisma.userSession.create({
    data: {
      token: sessionToken,
      userId: user.id,
      expiresAt
    }
  });

  return { user: currentUser, sessionToken, expiresAt };
}

export async function getCurrentUserBySessionToken(token: string): Promise<CurrentUser | null> {
  const prisma = getPrisma();
  const session = await prisma.userSession.findUnique({
    where: { token },
    include: {
      user: {
        include: {
          roles: {
            include: { role: true }
          }
        }
      }
    }
  });

  if (!session || session.expiresAt <= new Date() || session.user.status !== "ENABLED") {
    return null;
  }

  const roles = (session.user.roles as DbRole[])
    .filter((entry) => entry.role.status === "ENABLED" && isRoleCode(entry.role.code))
    .map((entry) => ({
      code: entry.role.code as UserRoleCode,
      name: entry.role.name
    }));

  if (roles.length === 0) return null;

  return {
    id: session.user.id,
    username: session.user.username,
    displayName: session.user.displayName,
    roles
  };
}

function isRoleCode(code: string): code is UserRoleCode {
  return code === "SUPER_ADMIN" || code === "WAREHOUSE_ADMIN" || code === "INVENTORY_VIEWER";
}
