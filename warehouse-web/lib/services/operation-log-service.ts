import { getPrisma } from "@/lib/db";
import { formatAppDateTime } from "@/lib/warehouse-utils";
import type { CurrentUser, OperationLog } from "@/lib/types";

export type OperationResult = "SUCCESS" | "FAILURE";

export type OperationLogInput = {
  user?: CurrentUser | null;
  request?: Request;
  action: string;
  targetType: string;
  targetId?: string;
  result: OperationResult;
  detail?: string;
};

export async function logOperation(input: OperationLogInput) {
  try {
    const prisma = getPrisma();
    await prisma.operationLog.create({
      data: {
        userId: input.user?.id,
        username: input.user?.username ?? "anonymous",
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        result: input.result,
        detail: input.detail,
        ipAddress: requestIp(input.request),
        userAgent: input.request?.headers.get("user-agent") ?? undefined
      }
    });
  } catch (error) {
    console.error("Failed to write operation log", error);
  }
}

export async function listOperationLogs(limit = 50): Promise<OperationLog[]> {
  const prisma = getPrisma();
  const logs = await prisma.operationLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit
  });

  return logs.map((log) => ({
    id: log.id,
    username: log.username,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId ?? undefined,
    result: log.result as OperationLog["result"],
    detail: log.detail ?? undefined,
    ipAddress: log.ipAddress ?? undefined,
    userAgent: log.userAgent ?? undefined,
    createdAt: formatAppDateTime(log.createdAt)
  }));
}

function requestIp(request?: Request) {
  if (!request) return undefined;
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    undefined
  );
}
