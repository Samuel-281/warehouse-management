import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { ApiError } from "@/lib/api-response";

export type IdempotencyOperation =
  | "INBOUND"
  | "OUTBOUND"
  | "SALES_RETURN"
  | "TRACKING_OUTBOUND"
  | "TRACKING_RETURN";

export type IdempotencyContext = {
  userId?: string;
  operationType: IdempotencyOperation;
  clientRequestId?: string;
  payload: unknown;
};

export type IdempotentServiceResult<T extends object> = T & {
  idempotentReplay: boolean;
};

const retentionMs = 30 * 24 * 60 * 60 * 1000;

export async function runIdempotentTransaction<T extends object>(
  prisma: PrismaClient,
  context: IdempotencyContext,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<IdempotentServiceResult<T>> {
  const clientRequestId = normalizeClientRequestId(context.clientRequestId);
  if (!clientRequestId || !context.userId) {
    const data = await prisma.$transaction(operation);
    return { ...data, idempotentReplay: false };
  }

  const requestHash = fingerprint(context.payload);
  try {
    const data = await prisma.$transaction(async (tx) => {
      const request = await tx.businessRequest.create({
        data: {
          userId: context.userId!,
          operationType: context.operationType,
          clientRequestId,
          requestHash,
          expiresAt: new Date(Date.now() + retentionMs)
        }
      });
      const result = await operation(tx);
      await tx.businessRequest.update({
        where: { id: request.id },
        data: {
          responseJson: toJsonValue(result),
          orderId: readOrderId(result),
          completedAt: new Date()
        }
      });
      return result;
    });
    return { ...data, idempotentReplay: false };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;

    const existing = await prisma.businessRequest.findUnique({
      where: {
        userId_operationType_clientRequestId: {
          userId: context.userId,
          operationType: context.operationType,
          clientRequestId
        }
      }
    });
    if (!existing) throw error;
    if (existing.requestHash !== requestHash) {
      throw new ApiError("该请求编号已用于不同业务内容，请刷新页面后重新提交", 409);
    }
    if (!existing.responseJson || !existing.completedAt) {
      throw new ApiError("该业务仍在处理中，请稍后使用原请求重试", 409);
    }

    return {
      ...(existing.responseJson as T),
      idempotentReplay: true
    };
  }
}

export function splitIdempotencyMetadata<T extends object>(result: IdempotentServiceResult<T>) {
  const { idempotentReplay, ...data } = result;
  return { data: data as T, idempotentReplay };
}

export function requestFingerprint(payload: unknown) {
  return fingerprint(payload);
}

function normalizeClientRequestId(value?: string) {
  if (value === undefined || value === null || value.trim() === "") return undefined;
  const requestId = value.trim();
  if (requestId.length < 8 || requestId.length > 128) {
    throw new ApiError("clientRequestId 长度必须为 8 至 128 个字符", 400);
  }
  return requestId;
}

function fingerprint(payload: unknown) {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function readOrderId(value: object) {
  const orderId = (value as { orderId?: unknown }).orderId;
  return typeof orderId === "string" ? orderId : undefined;
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
