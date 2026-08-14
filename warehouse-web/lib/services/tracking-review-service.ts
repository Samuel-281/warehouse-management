import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api-response";
import { getPrisma } from "@/lib/db";
import { mapTrackingOrderReview, mapTrackingReviewStatus } from "@/lib/services/tracking-service";
import type { TrackingReviewListResult, TrackingReviewTargetSummary } from "@/lib/types";
import { formatAppDateTime } from "@/lib/warehouse-utils";

export type SaveTrackingReviewInput = {
  targetType: "order" | "group";
  targetId: string;
  actualTotalQuantity: number;
  items?: Array<{ productCategoryId: string; quantity: number }>;
  operatorName: string;
  operatorUserId?: string;
  isSuperAdmin: boolean;
};

export async function listTrackingReviewTargets(input: {
  page?: number;
  pageSize?: number;
  status?: string;
}): Promise<TrackingReviewListResult> {
  const prisma = getPrisma();
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const offset = (page - 1) * pageSize;
  const status = reviewStatus(input.status);
  const candidatesSql = reviewCandidateSql(status);
  const [candidates, totals, pendingCounts] = await Promise.all([
    prisma.$queryRaw<ReviewCandidate[]>(Prisma.sql`
      WITH candidates AS (${candidatesSql})
      SELECT id, kind, "businessAt"
      FROM candidates
      ORDER BY "businessAt" DESC, id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `),
    prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      WITH candidates AS (${candidatesSql})
      SELECT COUNT(*)::integer AS total FROM candidates
    `),
    prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      WITH candidates AS (${reviewCandidateSql("PENDING")})
      SELECT COUNT(*)::integer AS total FROM candidates
    `)
  ]);

  const orderIds = candidates.filter((row) => row.kind === "order").map((row) => row.id);
  const groupIds = candidates.filter((row) => row.kind === "group").map((row) => row.id);
  const [orders, groups, counts] = await Promise.all([
    prisma.trackingOrder.findMany({
      where: { id: { in: orderIds } },
      include: {
        reviews: { include: { items: true }, orderBy: { version: "desc" }, take: 1 },
        _count: { select: { items: true } }
      }
    }),
    prisma.trackingOrderGroup.findMany({
      where: { id: { in: groupIds } },
      include: {
        reviews: { include: { items: true }, orderBy: { version: "desc" }, take: 1 },
        members: { select: { order: { select: { orderNo: true } } } }
      }
    }),
    loadReviewTargetCounts(orderIds, groupIds)
  ]);
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const countByTarget = new Map(counts.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
  const items: TrackingReviewTargetSummary[] = [];
  for (const candidate of candidates) {
    const countsForTarget = countByTarget.get(`${candidate.kind}:${candidate.id}`) ?? { total: 0, active: 0 };
    if (candidate.kind === "order") {
      const order = orderById.get(candidate.id);
      if (!order || !order.sourceWarehouseId || order.type === "RETURN") continue;
      items.push({
        targetType: "order",
        id: order.id,
        orderNo: order.orderNo,
        type: order.type === "TRANSFER" ? "transfer" as const : "sales_outbound" as const,
        sourceWarehouseId: order.sourceWarehouseId,
        targetWarehouseId: order.targetWarehouseId ?? undefined,
        salespersonId: order.salespersonId ?? undefined,
        operator: order.operatorName,
        createdAt: formatAppDateTime(candidate.businessAt),
        reviewStatus: mapTrackingReviewStatus(order.reviewStatus),
        barcodeCount: countsForTarget.total,
        activeBarcodeCount: countsForTarget.active,
        voidedBarcodeCount: countsForTarget.total - countsForTarget.active,
        latestReview: order.reviews[0] ? mapTrackingOrderReview(order.reviews[0]) : undefined
      });
      continue;
    }
    const group = groupById.get(candidate.id);
    if (!group) continue;
    items.push({
      targetType: "group",
      id: group.id,
      orderNo: group.groupNo,
      type: group.type === "TRANSFER" ? "transfer" as const : "sales_outbound" as const,
      sourceWarehouseId: group.sourceWarehouseId,
      targetWarehouseId: group.targetWarehouseId ?? undefined,
      salespersonId: group.salespersonId ?? undefined,
      operator: group.operatorName,
      createdAt: formatAppDateTime(candidate.businessAt),
      reviewStatus: mapTrackingReviewStatus(group.reviewStatus),
      barcodeCount: countsForTarget.total,
      activeBarcodeCount: countsForTarget.active,
      voidedBarcodeCount: countsForTarget.total - countsForTarget.active,
      latestReview: group.reviews[0] ? mapTrackingOrderReview(group.reviews[0]) : undefined
    });
  }

  return {
    items,
    total: Number(totals[0]?.total ?? 0),
    page,
    pageSize,
    pendingCount: Number(pendingCounts[0]?.total ?? 0)
  };
}

export async function saveTrackingReview(input: SaveTrackingReviewInput) {
  assertNonnegativeInteger(input.actualTotalQuantity, "实际总出货数量");
  const normalizedItems = normalizeReviewItems(input.items ?? []);
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const target = input.targetType === "order"
      ? await tx.trackingOrder.findUnique({ where: { id: input.targetId } })
      : await tx.trackingOrderGroup.findUnique({ where: { id: input.targetId } });
    if (!target) throw new ApiError("出库单不存在", 404);
    if (target.type === "RETURN") throw new ApiError("扫码回库单无需复核", 409);
    if (target.status !== "ACTIVE") throw new ApiError("只有有效的主业务单据可以复核", 409);
    if (target.reviewStatus === "EXEMPT") throw new ApiError("历史免复核单据无需补做复核", 409);
    if (target.reviewStatus === "REVIEWED" && !input.isSuperAdmin) {
      throw new ApiError("该单据已经复核，只有超级管理员可以修订", 403);
    }

    const categories = normalizedItems.length > 0
      ? await tx.productCategory.findMany({ where: { id: { in: normalizedItems.map((item) => item.productCategoryId) } } })
      : [];
    if (categories.length !== normalizedItems.length) throw new ApiError("部分商品品类不存在，请刷新后重试", 400);
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const previous = input.targetType === "order"
      ? await tx.trackingOrderReview.findFirst({ where: { orderId: input.targetId }, orderBy: { version: "desc" } })
      : await tx.trackingOrderReview.findFirst({ where: { groupId: input.targetId }, orderBy: { version: "desc" } });
    const activeBarcodeCount = input.targetType === "order"
      ? await tx.trackingOrderBarcode.count({ where: { orderId: input.targetId, trackedBarcode: { status: "ACTIVE" } } })
      : await tx.trackingOrderBarcode.count({
          where: { order: { groupMembership: { groupId: input.targetId } }, trackedBarcode: { status: "ACTIVE" } }
        });

    const review = await tx.trackingOrderReview.create({
      data: {
        targetType: input.targetType === "order" ? "ORDER" : "GROUP",
        orderId: input.targetType === "order" ? input.targetId : undefined,
        groupId: input.targetType === "group" ? input.targetId : undefined,
        version: (previous?.version ?? 0) + 1,
        actualTotalQuantity: input.actualTotalQuantity,
        activeBarcodeCount,
        operatorId: input.operatorUserId,
        operatorName: input.operatorName,
        items: {
          create: normalizedItems.map((item) => ({
            productCategoryId: item.productCategoryId,
            categoryName: categoryById.get(item.productCategoryId)!.name,
            quantity: item.quantity
          }))
        }
      },
      include: { items: true }
    });
    if (input.targetType === "order") {
      await tx.trackingOrder.update({ where: { id: input.targetId }, data: { reviewStatus: "REVIEWED" } });
    } else {
      await tx.trackingOrderGroup.update({ where: { id: input.targetId }, data: { reviewStatus: "REVIEWED" } });
    }
    return mapTrackingOrderReview(review);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function normalizeReviewItems(items: Array<{ productCategoryId: string; quantity: number }>) {
  const normalized = items.map((item) => ({ productCategoryId: item.productCategoryId.trim(), quantity: item.quantity }));
  for (const item of normalized) {
    if (!item.productCategoryId) throw new ApiError("商品品类不能为空", 400);
    assertNonnegativeInteger(item.quantity, "商品品类数量");
  }
  if (new Set(normalized.map((item) => item.productCategoryId)).size !== normalized.length) {
    throw new ApiError("同一商品品类不能重复填写", 400);
  }
  return normalized;
}

function assertNonnegativeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new ApiError(`${label}必须是包括 0 在内的非负整数`, 400);
}

function reviewStatus(value?: string) {
  return value === "pending" ? "PENDING" : value === "reviewed" ? "REVIEWED" : value === "exempt" ? "EXEMPT" : undefined;
}

function reviewCandidateSql(status?: "PENDING" | "REVIEWED" | "EXEMPT") {
  return Prisma.sql`
    SELECT order_row.id, 'order'::text AS kind, order_row."createdAt" AS "businessAt"
    FROM "tracking_orders" AS order_row
    WHERE order_row."type" IN ('SALES_OUTBOUND', 'TRANSFER')
      AND order_row."status" = 'ACTIVE'
      ${status ? Prisma.sql`AND order_row."reviewStatus" = ${status}::"TrackingReviewStatus"` : Prisma.sql``}
    UNION ALL
    SELECT group_row.id, 'group'::text AS kind, MAX(member_order."createdAt") AS "businessAt"
    FROM "tracking_order_groups" AS group_row
    JOIN "tracking_order_group_members" AS member ON member."groupId" = group_row.id
    JOIN "tracking_orders" AS member_order ON member_order.id = member."orderId"
    WHERE group_row."status" = 'ACTIVE'
      ${status ? Prisma.sql`AND group_row."reviewStatus" = ${status}::"TrackingReviewStatus"` : Prisma.sql``}
    GROUP BY group_row.id
  `;
}

async function loadReviewTargetCounts(orderIds: string[], groupIds: string[]) {
  const prisma = getPrisma();
  const orderCounts = orderIds.length > 0
    ? await prisma.$queryRaw<ReviewCount[]>(Prisma.sql`
        SELECT 'order'::text AS kind, item."orderId" AS id,
          COUNT(*)::integer AS total,
          COUNT(*) FILTER (WHERE barcode.status = 'ACTIVE')::integer AS active
        FROM "tracking_order_barcodes" AS item
        JOIN "tracked_barcodes" AS barcode ON barcode.id = item."trackedBarcodeId"
        WHERE item."orderId" IN (${Prisma.join(orderIds)})
        GROUP BY item."orderId"
      `)
    : [];
  const groupCounts = groupIds.length > 0
    ? await prisma.$queryRaw<ReviewCount[]>(Prisma.sql`
        SELECT 'group'::text AS kind, member."groupId" AS id,
          COUNT(*)::integer AS total,
          COUNT(*) FILTER (WHERE barcode.status = 'ACTIVE')::integer AS active
        FROM "tracking_order_group_members" AS member
        JOIN "tracking_order_barcodes" AS item ON item."orderId" = member."orderId"
        JOIN "tracked_barcodes" AS barcode ON barcode.id = item."trackedBarcodeId"
        WHERE member."groupId" IN (${Prisma.join(groupIds)})
        GROUP BY member."groupId"
      `)
    : [];
  return [...orderCounts, ...groupCounts];
}

function normalizePage(value?: number) {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 1;
}

function normalizePageSize(value?: number) {
  return Number.isFinite(value) && value && value > 0 ? Math.min(50, Math.floor(value)) : 20;
}

type ReviewCandidate = { id: string; kind: "order" | "group"; businessAt: Date };
type ReviewCount = { id: string; kind: "order" | "group"; total: number; active: number };
