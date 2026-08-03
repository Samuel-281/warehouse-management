import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api-response";
import { getPrisma } from "@/lib/db";
import { buildTrackingCreatedAtRange } from "@/lib/services/tracking-date-range";
import {
  getTrackingOrderDetail,
  mapTrackingOrder,
  summarizeTrackingOrderGoodsReceipts,
  summarizeTrackingOrderReceipts
} from "@/lib/services/tracking-service";
import type {
  TrackingOrderFeedResult,
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
  const offset = (page - 1) * pageSize;
  const entries = buildTrackingGroupEntries(input);
  const [candidates, totals] = await Promise.all([
    prisma.$queryRaw<GroupCandidateRow[]>(Prisma.sql`
      WITH group_entries AS (${entries})
      SELECT id, "createdAt"
      FROM group_entries
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `),
    prisma.$queryRaw<FeedCountRow[]>(Prisma.sql`
      WITH group_entries AS (${entries})
      SELECT COUNT(*)::integer AS total
      FROM group_entries
    `)
  ]);
  const groups = await prisma.trackingOrderGroup.findMany({
      where: { id: { in: candidates.map((candidate) => candidate.id) } },
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
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const items = candidates
    .map((candidate) => groupById.get(candidate.id))
    .filter((group): group is NonNullable<typeof group> => Boolean(group))
    .map(mapTrackingOrderGroup);
  return { items, total: Number(totals[0]?.total ?? 0), page, pageSize };
}

export async function listTrackingOrderFeed(input: {
  page?: number;
  pageSize?: number;
  type?: string;
  startDate?: string;
  endDate?: string;
}): Promise<TrackingOrderFeedResult> {
  const prisma = getPrisma();
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const offset = (page - 1) * pageSize;
  const union = buildTrackingOrderFeedUnion(input);
  const [candidates, totals] = await Promise.all([
    prisma.$queryRaw<FeedCandidateRow[]>(Prisma.sql`
      WITH feed_entries AS (${union})
      SELECT id, kind, "createdAt"
      FROM feed_entries
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `),
    prisma.$queryRaw<FeedCountRow[]>(Prisma.sql`
      WITH feed_entries AS (${union})
      SELECT COUNT(*)::integer AS total
      FROM feed_entries
    `)
  ]);

  const orderIds = candidates.filter((row) => row.kind === "order").map((row) => row.id);
  const groupIds = candidates.filter((row) => row.kind === "group").map((row) => row.id);
  const [orders, groups] = await Promise.all([
    prisma.trackingOrder.findMany({
      where: { id: { in: orderIds } },
      include: {
        items: { orderBy: { barcode: "asc" }, take: 4 },
        _count: { select: { items: true } }
      }
    }),
    prisma.trackingOrderGroup.findMany({
      where: { id: { in: groupIds } },
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
    })
  ]);
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const items: TrackingOrderFeedResult["items"] = [];
  for (const candidate of candidates) {
    if (candidate.kind === "order") {
      const order = orderById.get(candidate.id);
      if (order) items.push({ kind: "order", order: mapTrackingOrder(order) });
      continue;
    }
    const group = groupById.get(candidate.id);
    if (!group) continue;
    const memberOrders = [...group.members]
      .sort((left, right) => right.order.createdAt.getTime() - left.order.createdAt.getTime())
      .map((member) => mapTrackingOrder(member.order));
    items.push({ kind: "group", group: mapTrackingOrderGroup(group), memberOrders });
  }

  return {
    items,
    total: Number(totals[0]?.total ?? 0),
    page,
    pageSize
  };
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
    order: TrackingOrderWithPreview;
  }>;
};

type TrackingOrderWithPreview = {
  id: string;
  orderNo: string;
  type: "SALES_OUTBOUND" | "TRANSFER" | "RETURN";
  sourceWarehouseId: string | null;
  targetWarehouseId: string | null;
  salespersonId: string | null;
  operatorName: string;
  createdAt: Date;
  status: "ACTIVE" | "VOIDED";
  items: Array<{ barcode: string }>;
  _count: { items: number };
};

type FeedCandidateRow = {
  id: string;
  kind: "order" | "group";
  createdAt: Date;
};

type GroupCandidateRow = {
  id: string;
  createdAt: Date;
};

type FeedCountRow = {
  total: number;
};

function mapTrackingOrderGroup(group: GroupWithOrders): TrackingOrderGroupSummary {
  const orderedMembers = [...group.members].sort((left, right) => left.order.orderNo.localeCompare(right.order.orderNo));
  const latestOrderAt = group.members.reduce<Date | undefined>((latest, member) => {
    return !latest || member.order.createdAt > latest ? member.order.createdAt : latest;
  }, undefined);
  return {
    id: group.id,
    groupNo: group.groupNo,
    type: group.type === "TRANSFER" ? "transfer" : "sales_outbound",
    sourceWarehouseId: group.sourceWarehouseId,
    targetWarehouseId: group.targetWarehouseId ?? undefined,
    salespersonId: group.salespersonId ?? undefined,
    operator: group.operatorName,
    createdAt: formatAppDateTime(latestOrderAt ?? group.createdAt),
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

function buildTrackingOrderFeedUnion(input: { type?: string; startDate?: string; endDate?: string }) {
  const createdAt = buildTrackingCreatedAtRange(input);
  return Prisma.sql`
    SELECT order_row.id, 'order'::text AS kind, order_row."createdAt"
    FROM "tracking_orders" AS order_row
    LEFT JOIN "tracking_order_group_members" AS membership ON membership."orderId" = order_row.id
    WHERE membership.id IS NULL
      ${trackingOrderTypeClause(input.type, "order")}
      ${trackingDateClause(createdAt, Prisma.sql`order_row."createdAt"`)}
    UNION ALL
    SELECT group_row.id, 'group'::text AS kind, MAX(member_order."createdAt") AS "createdAt"
    FROM "tracking_order_groups" AS group_row
    JOIN "tracking_order_group_members" AS membership ON membership."groupId" = group_row.id
    JOIN "tracking_orders" AS member_order ON member_order.id = membership."orderId"
    WHERE 1=1
      ${trackingOrderTypeClause(input.type, "group")}
    GROUP BY group_row.id
    HAVING 1=1
      ${trackingDateClause(createdAt, Prisma.sql`MAX(member_order."createdAt")`)}
  `;
}

function buildTrackingGroupEntries(input: { type?: string; startDate?: string; endDate?: string }) {
  const createdAt = buildTrackingCreatedAtRange(input);
  return Prisma.sql`
    SELECT group_row.id, MAX(member_order."createdAt") AS "createdAt"
    FROM "tracking_order_groups" AS group_row
    JOIN "tracking_order_group_members" AS membership ON membership."groupId" = group_row.id
    JOIN "tracking_orders" AS member_order ON member_order.id = membership."orderId"
    WHERE 1=1
      ${trackingOrderTypeClause(input.type, "group")}
    GROUP BY group_row.id
    HAVING 1=1
      ${trackingDateClause(createdAt, Prisma.sql`MAX(member_order."createdAt")`)}
  `;
}

function trackingOrderTypeClause(type: string | undefined, rowKind: "order" | "group") {
  if (!type || type === "all") return Prisma.sql``;
  if (type === "return" && rowKind === "group") return Prisma.sql`AND FALSE`;
  const dbType = type === "sales_outbound" ? "SALES_OUTBOUND" : type === "transfer" ? "TRANSFER" : type === "return" ? "RETURN" : undefined;
  if (!dbType) return Prisma.sql``;
  const column = Prisma.raw(`${rowKind}_row."type"`);
  return Prisma.sql`AND ${column} = ${dbType}::"TrackingOrderType"`;
}

function trackingDateClause(
  createdAt: { gte?: Date; lt?: Date } | undefined,
  column: Prisma.Sql
) {
  if (!createdAt) return Prisma.sql``;
  return Prisma.sql`
    ${createdAt.gte ? Prisma.sql`AND ${column} >= ${createdAt.gte}` : Prisma.sql``}
    ${createdAt.lt ? Prisma.sql`AND ${column} < ${createdAt.lt}` : Prisma.sql``}
  `;
}
