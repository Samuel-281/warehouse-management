import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api-response";
import { getPrisma } from "@/lib/db";

type OutboundType = "sales_outbound" | "transfer";

export type CorrectTrackingRouteInput = {
  targetType: "order" | "group";
  targetId: string;
  type: OutboundType;
  sourceWarehouseId: string;
  targetWarehouseId?: string;
  salespersonId?: string;
  note?: string;
  operatorName: string;
  operatorUserId?: string;
};

export type VoidTrackingBusinessInput = {
  targetType: "order" | "group";
  targetId: string;
  note?: string;
  operatorName: string;
  operatorUserId?: string;
};

export async function deleteTrackedBarcodeRecords(input: {
  barcode: string;
  note?: string;
  operatorName: string;
  operatorUserId?: string;
}) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const item = await tx.trackedBarcode.findUnique({
      where: { barcode: input.barcode.trim() },
      include: {
        orderItems: {
          select: {
            orderId: true,
            order: {
              select: {
                reviewStatus: true,
                groupMembership: { select: { groupId: true } }
              }
            }
          }
        }
      }
    });
    if (!item) throw new ApiError("追踪条码不存在", 404);
    if (item.status === "WRITTEN_OFF") throw new ApiError("已核销条码属于最终业务记录，不能通过错误条码入口删除", 409);
    const receiptCount = await tx.terminalReceiptRecord.count({ where: { barcode: item.barcode } });
    if (receiptCount > 0) throw new ApiError("该条码已有勤策签收记录，属于外部数据已确认的有效条码，不能删除", 409);
    const orderIds = Array.from(new Set(item.orderItems.map((entry) => entry.orderId)));
    const groupIds = Array.from(new Set(item.orderItems.flatMap((entry) => entry.order.groupMembership?.groupId ? [entry.order.groupMembership.groupId] : [])));
    const reviewedOrderIds = item.orderItems
      .filter((entry) => entry.order.reviewStatus === "REVIEWED")
      .map((entry) => entry.orderId);

    await tx.trackingMovement.deleteMany({ where: { trackedBarcodeId: item.id } });
    await tx.trackingOrderBarcode.deleteMany({ where: { trackedBarcodeId: item.id } });
    await tx.trackedBarcode.delete({ where: { id: item.id } });

    if (reviewedOrderIds.length > 0) {
      await tx.trackingOrder.updateMany({ where: { id: { in: reviewedOrderIds } }, data: { correctedAfterReview: true } });
    }
    if (groupIds.length > 0) {
      await tx.trackingOrderGroup.updateMany({ where: { id: { in: groupIds }, reviewStatus: "REVIEWED" }, data: { correctedAfterReview: true } });
    }
    await removeEmptyTrackingOrders(tx, orderIds);
    return { action: "deleted" as const, barcode: item.barcode };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function correctTrackingRoute(input: CorrectTrackingRouteInput) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const route = await validateRoute(tx, input);
    const context = await loadBusinessContext(tx, input.targetType, input.targetId);
    assertCorrectableContext(context);
    if (
      context.type === route.type
      && context.sourceWarehouseId === route.sourceWarehouseId
      && context.targetWarehouseId === route.targetWarehouseId
      && context.salespersonId === route.salespersonId
    ) {
      throw new ApiError("纠正后的出库信息与当前信息完全相同", 400);
    }
    const activeItems = context.items.filter((item) => item.trackedBarcode.status === "ACTIVE");
    const laterActivity = await findLaterTrackingActivity(
      tx,
      activeItems,
      context.orderIds,
      input.targetType === "group" ? context.id : undefined
    );
    const correctionMode = laterActivity ? "history_only" as const : "current_state" as const;

    const occurredAt = new Date();
    if (correctionMode === "current_state") {
      const targetOwnerType = route.type === "TRANSFER" ? "WAREHOUSE" as const : "SALESPERSON" as const;
      const targetLabel = route.type === "TRANSFER" ? `仓库：${route.targetWarehouseName}` : `销售人员：${route.salespersonName}`;
      for (const item of activeItems) {
        const fromLabel = await ownerLabel(tx, item.trackedBarcode);
        await tx.trackedBarcode.update({
          where: { id: item.trackedBarcode.id },
          data: {
            currentOwnerType: targetOwnerType,
            warehouseId: route.targetWarehouseId,
            salespersonId: route.salespersonId,
            terminalStoreName: null,
            receiptStatus: "PENDING",
            signedAt: null,
            lastMovedAt: occurredAt
          }
        });
        await tx.trackingMovement.create({
          data: {
            trackedBarcodeId: item.trackedBarcode.id,
            barcode: item.barcode,
            type: "ORDER_CORRECTION",
            fromOwnerType: item.trackedBarcode.currentOwnerType,
            toOwnerType: targetOwnerType,
            fromLabel,
            toLabel: targetLabel,
            operatorId: input.operatorUserId,
            operatorName: input.operatorName,
            occurredAt,
            note: cleanNote(input.note) ?? "管理员纠正出库路线",
            orderId: input.targetType === "order" ? context.id : undefined,
            orderNo: input.targetType === "order" ? context.number : undefined,
            groupId: input.targetType === "group" ? context.id : undefined,
            groupNo: input.targetType === "group" ? context.number : undefined
          }
        });
      }

      if (context.sourceWarehouseId !== route.sourceWarehouseId) {
        await tx.trackingOrderBarcode.updateMany({
          where: { orderId: { in: context.orderIds }, createdTrackingItem: false },
          data: {
            beforeOwnerType: "WAREHOUSE",
            beforeWarehouseId: route.sourceWarehouseId,
            beforeSalespersonId: null,
            beforeTerminalStoreName: null,
            beforeReceiptStatus: "PENDING",
            beforeSignedAt: null
          }
        });
      }
    }

    const correctionData = {
      beforeType: context.type,
      afterType: route.type,
      beforeSourceWarehouseId: context.sourceWarehouseId,
      afterSourceWarehouseId: route.sourceWarehouseId,
      beforeTargetWarehouseId: context.targetWarehouseId,
      afterTargetWarehouseId: route.targetWarehouseId,
      beforeSalespersonId: context.salespersonId,
      afterSalespersonId: route.salespersonId,
      note: correctionAuditNote(input.note, correctionMode),
      operatorId: input.operatorUserId,
      operatorName: input.operatorName
    };
    if (input.targetType === "order") {
      await tx.trackingOrderCorrection.create({
        data: { targetType: "ORDER", orderId: context.id, ...correctionData }
      });
      await tx.trackingOrder.update({
        where: { id: context.id },
        data: {
          type: route.type,
          sourceWarehouseId: route.sourceWarehouseId,
          targetWarehouseId: route.targetWarehouseId,
          salespersonId: route.salespersonId,
          correctedAfterReview: context.reviewStatus === "REVIEWED" ? true : context.correctedAfterReview
        }
      });
    } else {
      await tx.trackingOrderCorrection.create({
        data: { targetType: "GROUP", groupId: context.id, ...correctionData }
      });
      await tx.trackingOrderGroup.update({
        where: { id: context.id },
        data: {
          type: route.type,
          sourceWarehouseId: route.sourceWarehouseId,
          targetWarehouseId: route.targetWarehouseId,
          salespersonId: route.salespersonId,
          correctedAt: occurredAt,
          correctedAfterReview: context.reviewStatus === "REVIEWED" ? true : context.correctedAfterReview
        }
      });
    }
    return {
      id: context.id,
      number: context.number,
      correctionMode,
      updatedBarcodeCount: correctionMode === "current_state" ? activeItems.length : 0
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function voidTrackingBusiness(input: VoidTrackingBusinessInput) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const context = await loadBusinessContext(tx, input.targetType, input.targetId);
    assertCorrectableContext(context);
    const activeItems = context.items.filter((item) => item.trackedBarcode.status === "ACTIVE");
    if (activeItems.length !== context.items.length) throw new ApiError("单据中已有条码被删除或核销，不能回滚删除整单", 409);
    const receiptCount = await tx.terminalReceiptRecord.count({
      where: { trackedBarcodeId: { in: activeItems.map((item) => item.trackedBarcode.id) } }
    });
    if (receiptCount > 0) throw new ApiError("单据中已有条码存在勤策签收记录，不能回滚删除", 409);
    await assertNoLaterMovement(tx, activeItems, context.orderIds, input.targetType === "group" ? context.id : undefined);
    const newTrackedBarcodeIds: string[] = [];
    for (const item of activeItems) {
      if (item.createdTrackingItem) newTrackedBarcodeIds.push(item.trackedBarcode.id);
    }

    await deleteTrackingBusinessRecords(tx, context.orderIds, input.targetType === "group" ? context.id : undefined);

    for (const item of activeItems) {
      if (item.createdTrackingItem) continue;
      const latestMovement = await tx.trackingMovement.findFirst({
        where: { trackedBarcodeId: item.trackedBarcode.id },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        select: { occurredAt: true }
      });
      await tx.trackedBarcode.update({
        where: { id: item.trackedBarcode.id },
        data: {
          currentOwnerType: item.beforeOwnerType ?? "WAREHOUSE",
          warehouseId: item.beforeWarehouseId,
          salespersonId: item.beforeSalespersonId,
          terminalStoreName: item.beforeTerminalStoreName,
          receiptStatus: item.beforeReceiptStatus ?? "PENDING",
          signedAt: item.beforeSignedAt,
          status: "ACTIVE",
          lastMovedAt: latestMovement?.occurredAt ?? item.trackedBarcode.createdAt
        }
      });
    }

    if (newTrackedBarcodeIds.length > 0) {
      await tx.trackingMovement.deleteMany({ where: { trackedBarcodeId: { in: newTrackedBarcodeIds } } });
      await tx.trackedBarcode.deleteMany({ where: { id: { in: newTrackedBarcodeIds } } });
    }
    return { id: context.id, number: context.number, restoredBarcodeCount: activeItems.length, deleted: true as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function deleteTrackingBusinessRecords(
  tx: Prisma.TransactionClient,
  orderIds: string[],
  groupId?: string
) {
  const orderReviews = await tx.trackingOrderReview.findMany({
    where: { orderId: { in: orderIds } },
    select: { id: true }
  });
  const groupReviews = groupId ? await tx.trackingOrderReview.findMany({
    where: { groupId },
    select: { id: true }
  }) : [];
  const reviewIds = [...orderReviews, ...groupReviews].map((review) => review.id);
  if (reviewIds.length > 0) {
    await tx.trackingOrderReviewItem.deleteMany({ where: { reviewId: { in: reviewIds } } });
    await tx.trackingOrderReview.deleteMany({ where: { id: { in: reviewIds } } });
  }
  await tx.trackingOrderCorrection.deleteMany({
    where: { OR: [{ orderId: { in: orderIds } }, ...(groupId ? [{ groupId }] : [])] }
  });
  await tx.trackingMovement.deleteMany({
    where: { OR: [{ orderId: { in: orderIds } }, ...(groupId ? [{ groupId }] : [])] }
  });
  if (groupId) await tx.trackingOrderGroup.delete({ where: { id: groupId } });
  await tx.trackingOrder.deleteMany({ where: { id: { in: orderIds } } });
}

async function removeEmptyTrackingOrders(tx: Prisma.TransactionClient, orderIds: string[]) {
  if (orderIds.length === 0) return;
  const orders = await tx.trackingOrder.findMany({
    where: { id: { in: orderIds } },
    include: {
      _count: { select: { items: true } },
      groupMembership: { select: { groupId: true } }
    }
  });
  const emptyOrders = orders.filter((order) => order._count.items === 0);
  const emptyOrderIds = emptyOrders.map((order) => order.id);
  const affectedGroupIds = Array.from(new Set(orders.flatMap((order) => order.groupMembership?.groupId ? [order.groupMembership.groupId] : [])));
  if (emptyOrderIds.length > 0) {
    await tx.trackingOrderGroupMember.deleteMany({ where: { orderId: { in: emptyOrderIds } } });
    await deleteTrackingBusinessRecords(tx, emptyOrderIds);
  }
  for (const groupId of affectedGroupIds) {
    const group = await tx.trackingOrderGroup.findUnique({
      where: { id: groupId },
      select: { reviewStatus: true, _count: { select: { members: true } } }
    });
    if (!group) continue;
    if (group._count.members === 0) {
      await deleteTrackingBusinessRecords(tx, [], groupId);
    } else if (group.reviewStatus === "REVIEWED") {
      await tx.trackingOrderGroup.update({ where: { id: groupId }, data: { correctedAfterReview: true } });
    }
  }
}

async function validateRoute(tx: Prisma.TransactionClient, input: CorrectTrackingRouteInput) {
  const source = await tx.warehouse.findUnique({ where: { id: input.sourceWarehouseId } });
  if (!source || source.status !== "ENABLED") throw new ApiError("请选择有效的来源仓库", 400);
  if (input.type === "transfer") {
    const target = input.targetWarehouseId ? await tx.warehouse.findUnique({ where: { id: input.targetWarehouseId } }) : null;
    if (!target || target.status !== "ENABLED") throw new ApiError("请选择有效的目标仓库", 400);
    if (target.id === source.id) throw new ApiError("目标仓库不能与来源仓库相同", 400);
    return {
      type: "TRANSFER" as const,
      sourceWarehouseId: source.id,
      targetWarehouseId: target.id,
      targetWarehouseName: target.name,
      salespersonId: null,
      salespersonName: null
    };
  }
  const salesperson = input.salespersonId ? await tx.salesperson.findUnique({ where: { id: input.salespersonId } }) : null;
  if (!salesperson || salesperson.status !== "ENABLED") throw new ApiError("请选择有效的销售人员", 400);
  return {
    type: "SALES_OUTBOUND" as const,
    sourceWarehouseId: source.id,
    targetWarehouseId: null,
    targetWarehouseName: null,
    salespersonId: salesperson.id,
    salespersonName: salesperson.name
  };
}

async function loadBusinessContext(tx: Prisma.TransactionClient, targetType: "order" | "group", id: string) {
  if (targetType === "order") {
    const order = await tx.trackingOrder.findUnique({
      where: { id },
      include: { items: { include: { trackedBarcode: true } }, groupMembership: true }
    });
    if (!order) throw new ApiError("出库单不存在", 404);
    if (order.type === "RETURN") throw new ApiError("本轮不支持回库单纠错", 409);
    if (!order.sourceWarehouseId) throw new ApiError("出库单缺少来源仓库，无法纠错", 409);
    if (order.groupMembership || order.status === "MERGED") throw new ApiError("该单据已合并，请在合并后生成的出库单上操作", 409);
    return {
      id: order.id,
      number: order.orderNo,
      type: order.type,
      sourceWarehouseId: order.sourceWarehouseId,
      targetWarehouseId: order.targetWarehouseId,
      salespersonId: order.salespersonId,
      status: order.status,
      reviewStatus: order.reviewStatus,
      correctedAfterReview: order.correctedAfterReview,
      items: order.items,
      orderIds: [order.id]
    };
  }
  const group = await tx.trackingOrderGroup.findUnique({
    where: { id },
    include: {
      members: { include: { order: { include: { items: { include: { trackedBarcode: true } } } } } }
    }
  });
  if (!group) throw new ApiError("出库单不存在", 404);
  return {
    id: group.id,
    number: group.groupNo,
    type: group.type,
    sourceWarehouseId: group.sourceWarehouseId,
    targetWarehouseId: group.targetWarehouseId,
    salespersonId: group.salespersonId,
    status: group.status,
    reviewStatus: group.reviewStatus,
    correctedAfterReview: group.correctedAfterReview,
    items: group.members.flatMap((member) => member.order.items),
    orderIds: group.members.map((member) => member.order.id)
  };
}

function assertCorrectableContext(context: Awaited<ReturnType<typeof loadBusinessContext>>) {
  if (context.status !== "ACTIVE") throw new ApiError("只有有效的出库主单可以执行该操作", 409);
  if (context.items.length === 0) throw new ApiError("单据没有条码，无法执行该操作", 409);
}

async function assertNoLaterMovement(
  tx: Prisma.TransactionClient,
  items: Array<{ trackedBarcodeId: string; barcode: string }>,
  allowedOrderIds: string[],
  allowedGroupId?: string
) {
  const activity = await findLaterTrackingActivity(tx, items, allowedOrderIds, allowedGroupId);
  if (!activity) return;
  if (activity.type === "receipt") {
    throw new ApiError(`条码 ${activity.barcode} 已存在后续勤策签收记录，不能直接纠正或作废原单`, 409);
  }
  throw new ApiError(`条码 ${activity.barcode} 已发生后续签收或流转，不能直接纠正或作废原单`, 409);
}

async function findLaterTrackingActivity(
  tx: Prisma.TransactionClient,
  items: Array<{ trackedBarcodeId: string; barcode: string }>,
  allowedOrderIds: string[],
  allowedGroupId?: string
) {
  if (items.length === 0) return;
  const latest = await tx.trackingMovement.findMany({
    where: { trackedBarcodeId: { in: items.map((item) => item.trackedBarcodeId) } },
    orderBy: [{ trackedBarcodeId: "asc" }, { occurredAt: "desc" }, { id: "desc" }]
  });
  const latestByItem = new Map<string, (typeof latest)[number]>();
  const businessStartedAtByItem = new Map<string, Date>();
  for (const movement of latest) {
    if (!latestByItem.has(movement.trackedBarcodeId)) latestByItem.set(movement.trackedBarcodeId, movement);
    if (
      allowedOrderIds.includes(movement.orderId ?? "")
      && (movement.type === "SALES_OUTBOUND" || movement.type === "TRANSFER")
    ) {
      const previous = businessStartedAtByItem.get(movement.trackedBarcodeId);
      if (!previous || movement.occurredAt < previous) businessStartedAtByItem.set(movement.trackedBarcodeId, movement.occurredAt);
    }
  }
  const blocked = items.find((item) => {
    const movement = latestByItem.get(item.trackedBarcodeId);
    return !movement || (!allowedOrderIds.includes(movement.orderId ?? "") && movement.groupId !== allowedGroupId);
  });
  if (blocked) return { type: "movement" as const, barcode: blocked.barcode };
  const receipts = await tx.terminalReceiptRecord.findMany({
    where: { trackedBarcodeId: { in: items.map((item) => item.trackedBarcodeId) } },
    select: { trackedBarcodeId: true, barcode: true, scannedAt: true }
  });
  const laterReceipt = receipts.find((receipt) => {
    const businessStartedAt = receipt.trackedBarcodeId ? businessStartedAtByItem.get(receipt.trackedBarcodeId) : undefined;
    return businessStartedAt && receipt.scannedAt.getTime() >= businessStartedAt.getTime();
  });
  return laterReceipt ? { type: "receipt" as const, barcode: laterReceipt.barcode } : undefined;
}

function correctionAuditNote(note: string | undefined, mode: "current_state" | "history_only") {
  const cleaned = cleanNote(note);
  if (mode === "current_state") return cleaned;
  const systemNote = "仅修正历史单据信息，未改变条码当前归属和签收状态";
  return cleaned ? `${systemNote}；${cleaned}` : systemNote;
}

async function ownerLabel(tx: Prisma.TransactionClient, item: {
  currentOwnerType: "WAREHOUSE" | "SALESPERSON" | "TERMINAL_STORE";
  warehouseId: string | null;
  salespersonId: string | null;
  terminalStoreName: string | null;
}) {
  if (item.currentOwnerType === "TERMINAL_STORE") return `终端店铺：${item.terminalStoreName ?? "未知"}`;
  if (item.currentOwnerType === "SALESPERSON") {
    const person = item.salespersonId ? await tx.salesperson.findUnique({ where: { id: item.salespersonId }, select: { name: true } }) : null;
    return `销售人员：${person?.name ?? "未知"}`;
  }
  const warehouse = item.warehouseId ? await tx.warehouse.findUnique({ where: { id: item.warehouseId }, select: { name: true } }) : null;
  return `仓库：${warehouse?.name ?? "未知"}`;
}

function cleanNote(note?: string) {
  const value = note?.trim();
  return value || null;
}
