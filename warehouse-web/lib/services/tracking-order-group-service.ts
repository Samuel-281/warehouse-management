import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api-response";
import { getPrisma } from "@/lib/db";
import { buildTrackingCreatedAtRange } from "@/lib/services/tracking-date-range";
import {
  getTrackingOrderDetail,
  summarizeTrackingOrderGoodsReceipts,
  summarizeTrackingOrderReceipts
} from "@/lib/services/tracking-service";
import type {
  TrackingOrderGroupDetail,
  TrackingOrderGroupListResult,
  TrackingOrderGroupSummary
} from "@/lib/types";
import { formatAppDateTime } from "@/lib/warehouse-utils";

const MIN_GROUP_ORDERS = 2;
const MAX_GROUP_ORDERS = 20;
const MAX_GROUP_BARCODES = 5000;

export type CreateTrackingOrderGroupInput = {
  orderIds: string[];
  operatorName: string;
  operatorUserId?: string;
};

export async function createTrackingOrderGroup(input: CreateTrackingOrderGroupInput): Promise<TrackingOrderGroupSummary> {
  const orderIds = Array.from(new Set(input.orderIds.map((value) => value.trim()).filter(Boolean)));
  if (orderIds.length < MIN_GROUP_ORDERS) throw new ApiError("请至少选择 2 张出库单", 400);
  if (orderIds.length > MAX_GROUP_ORDERS) throw new ApiError(`单次最多合并 ${MAX_GROUP_ORDERS} 张出库单`, 400);

  const prisma = getPrisma();
  try {
    return await prisma.$transaction(async (tx) => {
      const orders = await tx.trackingOrder.findMany({
        where: { id: { in: orderIds } },
        include: {
          groupMembership: { select: { group: { select: { groupNo: true } } } },
          items: { orderBy: { barcode: "asc" }, take: 4 },
          _count: { select: { items: true } }
        }
      });
      if (orders.length !== orderIds.length) throw new ApiError("部分流转单据不存在，请刷新后重试", 404);

      const invalid = orders.find((order) =>
        (order.type !== "SALES_OUTBOUND" && order.type !== "TRANSFER") || order.status !== "ACTIVE"
      );
      if (invalid) throw new ApiError(`单据 ${invalid.orderNo} 不是有效的销售出库或挪仓单`, 409);
      const grouped = orders.find((order) => order.groupMembership);
      if (grouped) throw new ApiError(`单据 ${grouped.orderNo} 已属于合单 ${grouped.groupMembership?.group.groupNo}`, 409);

      const first = orders[0]!;
      if (!first.sourceWarehouseId) throw new ApiError("出库单缺少来源仓库", 409);
      if (first.type === "SALES_OUTBOUND" && !first.salespersonId) {
        throw new ApiError("销售出库单缺少销售人员", 409);
      }
      if (first.type === "TRANSFER" && !first.targetWarehouseId) {
        throw new ApiError("挪仓单缺少目标仓库", 409);
      }
      const mismatched = orders.find((order) =>
        order.type !== first.type
        || order.sourceWarehouseId !== first.sourceWarehouseId
        || order.salespersonId !== first.salespersonId
        || order.targetWarehouseId !== first.targetWarehouseId
      );
      if (mismatched) {
        throw new ApiError(
          first.type === "TRANSFER"
            ? "只能合并来源仓库和目标仓库都相同的挪仓单"
            : "只能合并来源仓库和销售人员都相同的销售出库单",
          409
        );
      }

      const barcodeCount = orders.reduce((total, order) => total + order._count.items, 0);
      if (barcodeCount > MAX_GROUP_BARCODES) throw new ApiError(`一个合单最多汇总 ${MAX_GROUP_BARCODES} 件箱码`, 400);

      const group = await tx.trackingOrderGroup.create({
        data: {
          groupNo: makeGroupNo(),
          type: first.type,
          sourceWarehouseId: first.sourceWarehouseId,
          targetWarehouseId: first.targetWarehouseId,
          salespersonId: first.salespersonId,
          operatorId: input.operatorUserId,
          operatorName: input.operatorName,
          members: { create: orderIds.map((orderId) => ({ orderId })) }
        },
        include: {
          members: {
            include: {
              order: {
                include: {
                  items: { orderBy: { barcode: "asc" }, take: 4 },
                  _count: { select: { items: true } }
                }
              }
            }
          }
        }
      });
      return mapTrackingOrderGroup(group);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError("其中一张单据刚刚已被加入其他合单，请刷新后重试", 409);
    }
    throw error;
  }
}

export async function listTrackingOrderGroups(input: {
  page?: number;
  pageSize?: number;
  type?: string;
  startDate?: string;
  endDate?: string;
}): Promise<TrackingOrderGroupListResult> {
  const prisma = getPrisma();
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const where: Prisma.TrackingOrderGroupWhereInput = {};
  if (input.type === "sales_outbound") where.type = "SALES_OUTBOUND";
  if (input.type === "transfer") where.type = "TRANSFER";
  const createdAt = buildTrackingCreatedAtRange(input);
  if (createdAt) where.createdAt = createdAt;
  const [total, groups] = await Promise.all([
    prisma.trackingOrderGroup.count({ where }),
    prisma.trackingOrderGroup.findMany({
      where,
      include: {
        members: {
          include: {
            order: {
              include: {
                items: { orderBy: { barcode: "asc" }, take: 4 },
                _count: { select: { items: true } }
              }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);
  return { items: groups.map(mapTrackingOrderGroup), total, page, pageSize };
}

export async function getTrackingOrderGroupDetail(groupId: string): Promise<TrackingOrderGroupDetail> {
  const prisma = getPrisma();
  const group = await prisma.trackingOrderGroup.findUnique({
    where: { id: groupId },
    include: {
      members: {
        include: {
          order: {
            include: {
              items: { orderBy: { barcode: "asc" }, take: 4 },
              _count: { select: { items: true } }
            }
          }
        }
      }
    }
  });
  if (!group) throw new ApiError("出库合单不存在", 404);

  const details = await Promise.all(group.members.map((member) => getTrackingOrderDetail(member.orderId)));
  details.sort((left, right) => left.order.createdAt.localeCompare(right.order.createdAt));
  const items = details.flatMap((detail) => detail.items.map((item) => ({
    ...item,
    orderId: detail.order.id,
    orderNo: detail.order.orderNo
  })));

  return {
    group: mapTrackingOrderGroup(group),
    memberOrders: details.map((detail) => detail.order),
    receiptSummary: summarizeTrackingOrderReceipts(items),
    goodsReceiptSummaries: summarizeTrackingOrderGoodsReceipts(items),
    items
  };
}

export async function dissolveTrackingOrderGroup(groupId: string) {
  const prisma = getPrisma();
  const group = await prisma.trackingOrderGroup.findUnique({
    where: { id: groupId },
    include: { _count: { select: { members: true } } }
  });
  if (!group) throw new ApiError("出库合单不存在", 404);
  await prisma.trackingOrderGroup.delete({ where: { id: groupId } });
  return { id: group.id, groupNo: group.groupNo, orderCount: group._count.members };
}

type GroupWithOrders = {
  id: string;
  groupNo: string;
  type: "SALES_OUTBOUND" | "TRANSFER" | "RETURN";
  sourceWarehouseId: string;
  targetWarehouseId: string | null;
  salespersonId: string | null;
  operatorName: string;
  createdAt: Date;
  members: Array<{
    order: {
      orderNo: string;
      _count: { items: number };
    };
  }>;
};

function mapTrackingOrderGroup(group: GroupWithOrders): TrackingOrderGroupSummary {
  const orderedMembers = [...group.members].sort((left, right) => left.order.orderNo.localeCompare(right.order.orderNo));
  return {
    id: group.id,
    groupNo: group.groupNo,
    type: group.type === "TRANSFER" ? "transfer" : "sales_outbound",
    sourceWarehouseId: group.sourceWarehouseId,
    targetWarehouseId: group.targetWarehouseId ?? undefined,
    salespersonId: group.salespersonId ?? undefined,
    operator: group.operatorName,
    createdAt: formatAppDateTime(group.createdAt),
    orderCount: orderedMembers.length,
    barcodeCount: orderedMembers.reduce((total, member) => total + member.order._count.items, 0),
    orderPreview: orderedMembers.slice(0, 4).map((member) => member.order.orderNo)
  };
}

function makeGroupNo() {
  return `HD${Date.now()}${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function normalizePage(value?: number) {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 1;
}

function normalizePageSize(value?: number) {
  return Number.isFinite(value) && value && value > 0 ? Math.min(50, Math.floor(value)) : 20;
}
