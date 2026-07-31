import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api-response";
import { assertBarcodeBatchLimit } from "@/lib/business-limits";
import { getPrisma } from "@/lib/db";
import { runIdempotentTransaction } from "@/lib/services/idempotency-service";
import { linkAndReconcileTrackedReceipts } from "@/lib/services/terminal-receipt-ownership-service";
import { formatAppDateTime } from "@/lib/warehouse-utils";
import type {
  OwnerType,
  TrackedBarcode,
  TrackingBarcodeDetail,
  TrackingBarcodeListResult,
  TrackingMovement,
  TrackingOrderBarcodeDetail,
  TrackingOrderDetail,
  TrackingOrderGoodsReceiptSummary,
  TrackingOrderListResult,
  TrackingOrderSummary,
  TrackingReceiptStatus,
  TrackingSummary
} from "@/lib/types";

type TrackingDestinationType = "salesperson" | "warehouse";

export type SubmitTrackingOutboundInput = {
  sourceWarehouseId: string;
  destinationType: TrackingDestinationType;
  salespersonId?: string;
  targetWarehouseId?: string;
  barcodes: string[];
  operatorName: string;
  operatorUserId?: string;
  clientRequestId?: string;
};

export type SubmitTrackingReturnInput = {
  returnWarehouseId: string;
  barcodes: string[];
  operatorName: string;
  operatorUserId?: string;
  clientRequestId?: string;
};

export type TrackingValidationInput = {
  mode: "outbound" | "return";
  barcodes: string[];
  sourceWarehouseId?: string;
  returnWarehouseId?: string;
};

export type TrackingValidationResult = {
  barcode: string;
  ok: boolean;
  label: string;
  detail: string;
  item?: TrackedBarcode;
};

export async function validateTrackingBarcodes(input: TrackingValidationInput): Promise<TrackingValidationResult[]> {
  const barcodes = normalizeBarcodes(input.barcodes);
  assertBarcodeBatchLimit(barcodes);
  if (barcodes.length === 0) return [];

  const prisma = getPrisma();
  const items = await prisma.trackedBarcode.findMany({ where: { barcode: { in: barcodes } } });
  const itemByBarcode = new Map(items.map((item) => [item.barcode, item]));

  return barcodes.map((barcode) => {
    const item = itemByBarcode.get(barcode);
    if (item && item.status !== "ACTIVE") {
      return {
        barcode,
        ok: false,
        label: item.status === "WRITTEN_OFF" ? "已核销" : "已结束追踪",
        detail: "该条码不能参与新的流转业务",
        item: mapTrackedBarcode(item)
      };
    }

    if (input.mode === "outbound") {
      if (!input.sourceWarehouseId) {
        return { barcode, ok: false, label: "缺少仓库", detail: "请先选择来源仓库" };
      }
      if (!item) return { barcode, ok: true, label: "新条码", detail: "提交后将建立条码流向档案" };
      if (item.currentOwnerType !== "WAREHOUSE" || item.warehouseId !== input.sourceWarehouseId) {
        return {
          barcode,
          ok: false,
          label: "归属不符",
          detail: "该条码当前不在所选来源仓库",
          item: mapTrackedBarcode(item)
        };
      }
      return { barcode, ok: true, label: "可出库", detail: "条码当前在所选来源仓库", item: mapTrackedBarcode(item) };
    }

    if (!item) return { barcode, ok: true, label: "新回库条码", detail: "将从外部流入建立追踪档案" };
    if (item.currentOwnerType === "WAREHOUSE") {
      return {
        barcode,
        ok: false,
        label: "已在仓库",
        detail: item.warehouseId === input.returnWarehouseId ? "条码已经在所选仓库" : "条码当前在其他仓库，请使用扫码出库进行挪仓",
        item: mapTrackedBarcode(item)
      };
    }
    return { barcode, ok: true, label: "可回库", detail: "系统将按当前归属生成回库履历", item: mapTrackedBarcode(item) };
  });
}

export async function submitTrackingOutbound(input: SubmitTrackingOutboundInput) {
  const barcodes = normalizeBarcodes(input.barcodes);
  assertBarcodeBatchLimit(barcodes);
  if (barcodes.length === 0) throw new ApiError("请先扫描或录入条码", 400);

  const prisma = getPrisma();
  return runIdempotentTransaction(
    prisma,
    {
      userId: input.operatorUserId,
      operationType: "TRACKING_OUTBOUND",
      clientRequestId: input.clientRequestId,
      payload: {
        sourceWarehouseId: input.sourceWarehouseId,
        destinationType: input.destinationType,
        salespersonId: input.salespersonId ?? null,
        targetWarehouseId: input.targetWarehouseId ?? null,
        barcodes
      }
    },
    async (tx) => {
      const sourceWarehouse = await tx.warehouse.findUnique({ where: { id: input.sourceWarehouseId } });
      if (!sourceWarehouse || sourceWarehouse.status !== "ENABLED") throw new ApiError("请选择有效的来源仓库", 400);

      const salesperson = input.destinationType === "salesperson" && input.salespersonId
        ? await tx.salesperson.findUnique({ where: { id: input.salespersonId } })
        : null;
      const targetWarehouse = input.destinationType === "warehouse" && input.targetWarehouseId
        ? await tx.warehouse.findUnique({ where: { id: input.targetWarehouseId } })
        : null;
      if (input.destinationType === "salesperson" && (!salesperson || salesperson.status !== "ENABLED")) {
        throw new ApiError("请选择有效的销售人员", 400);
      }
      if (input.destinationType === "warehouse") {
        if (!targetWarehouse || targetWarehouse.status !== "ENABLED") throw new ApiError("请选择有效的目标仓库", 400);
        if (targetWarehouse.id === sourceWarehouse.id) throw new ApiError("目标仓库不能与来源仓库相同", 400);
      }

      const existingItems = await tx.trackedBarcode.findMany({ where: { barcode: { in: barcodes } } });
      const invalid = existingItems.find(
        (item) => item.status !== "ACTIVE" || item.currentOwnerType !== "WAREHOUSE" || item.warehouseId !== sourceWarehouse.id
      );
      if (invalid) throw new ApiError(`条码 ${invalid.barcode} 当前不在所选来源仓库`, 409);

      const time = new Date();
      const order = await tx.trackingOrder.create({
        data: {
          orderNo: makeOrderNo(input.destinationType === "salesperson" ? "ZX" : "ZC"),
          type: input.destinationType === "salesperson" ? "SALES_OUTBOUND" : "TRANSFER",
          sourceWarehouseId: sourceWarehouse.id,
          targetWarehouseId: targetWarehouse?.id,
          salespersonId: salesperson?.id,
          operatorId: input.operatorUserId,
          operatorName: input.operatorName,
          createdAt: time
        }
      });

      const existingByBarcode = new Map(existingItems.map((item) => [item.barcode, item]));
      const missingBarcodes = barcodes.filter((barcode) => !existingByBarcode.has(barcode));
      if (missingBarcodes.length > 0) {
        await tx.trackedBarcode.createMany({
          data: missingBarcodes.map((barcode) => ({
            barcode,
            currentOwnerType: input.destinationType === "salesperson" ? "SALESPERSON" : "WAREHOUSE",
            warehouseId: targetWarehouse?.id ?? null,
            salespersonId: salesperson?.id ?? null,
            receiptStatus: "PENDING",
            status: "ACTIVE",
            lastMovedAt: time
          }))
        });
      }

      if (existingItems.length > 0) {
        const updated = await tx.trackedBarcode.updateMany({
          where: {
            id: { in: existingItems.map((item) => item.id) },
            status: "ACTIVE",
            currentOwnerType: "WAREHOUSE",
            warehouseId: sourceWarehouse.id
          },
          data: {
            currentOwnerType: input.destinationType === "salesperson" ? "SALESPERSON" : "WAREHOUSE",
            warehouseId: targetWarehouse?.id ?? null,
            salespersonId: salesperson?.id ?? null,
            terminalStoreName: null,
            signedAt: null,
            receiptStatus: "PENDING",
            lastMovedAt: time
          }
        });
        if (updated.count !== existingItems.length) throw new ApiError("部分条码已被其他设备处理，请重新校验", 409);
      }

      const persistedItems = await tx.trackedBarcode.findMany({ where: { barcode: { in: barcodes } } });
      if (persistedItems.length !== barcodes.length) throw new ApiError("条码写入不完整，请重试", 500);
      const destinationLabel = salesperson ? `销售人员：${salesperson.name}` : `仓库：${targetWarehouse!.name}`;
      const destinationOwnerType = salesperson ? "SALESPERSON" as const : "WAREHOUSE" as const;

      await tx.trackingOrderBarcode.createMany({
        data: persistedItems.map((item) => {
          const before = existingByBarcode.get(item.barcode);
          return {
            orderId: order.id,
            trackedBarcodeId: item.id,
            barcode: item.barcode,
            beforeOwnerType: before?.currentOwnerType,
            beforeWarehouseId: before?.warehouseId,
            beforeSalespersonId: before?.salespersonId,
            beforeTerminalStoreName: before?.terminalStoreName,
            beforeReceiptStatus: before?.receiptStatus,
            createdTrackingItem: !before
          };
        })
      });
      const movements = await tx.trackingMovement.createManyAndReturn({
        data: persistedItems.map((item) => ({
          trackedBarcodeId: item.id,
          barcode: item.barcode,
          type: salesperson ? "SALES_OUTBOUND" as const : "TRANSFER" as const,
          fromOwnerType: "WAREHOUSE" as const,
          toOwnerType: destinationOwnerType,
          fromLabel: `仓库：${sourceWarehouse.name}`,
          toLabel: destinationLabel,
          operatorId: input.operatorUserId,
          operatorName: input.operatorName,
          occurredAt: time,
          note: "条码流向出库，不维护商品数量库存",
          orderId: order.id,
          orderNo: order.orderNo
        }))
      });
      await linkAndReconcileTrackedReceipts(
        tx,
        persistedItems.map((item) => ({ id: item.id, barcode: item.barcode }))
      );

      return {
        orderId: order.id,
        orderNo: order.orderNo,
        quantity: persistedItems.length,
        items: persistedItems.map(mapTrackedBarcode),
        movements: movements.map(mapTrackingMovement)
      };
    }
  );
}

export async function submitTrackingReturn(input: SubmitTrackingReturnInput) {
  const barcodes = normalizeBarcodes(input.barcodes);
  assertBarcodeBatchLimit(barcodes);
  if (barcodes.length === 0) throw new ApiError("请先扫描或录入回库条码", 400);

  const prisma = getPrisma();
  return runIdempotentTransaction(
    prisma,
    {
      userId: input.operatorUserId,
      operationType: "TRACKING_RETURN",
      clientRequestId: input.clientRequestId,
      payload: { returnWarehouseId: input.returnWarehouseId, barcodes }
    },
    async (tx) => {
      const warehouse = await tx.warehouse.findUnique({ where: { id: input.returnWarehouseId } });
      if (!warehouse || warehouse.status !== "ENABLED") throw new ApiError("请选择有效的回库仓库", 400);

      const existingItems = await tx.trackedBarcode.findMany({ where: { barcode: { in: barcodes } } });
      const invalid = existingItems.find((item) => item.status !== "ACTIVE" || item.currentOwnerType === "WAREHOUSE");
      if (invalid) throw new ApiError(`条码 ${invalid.barcode} 已在仓库或不能继续追踪`, 409);

      const time = new Date();
      const order = await tx.trackingOrder.create({
        data: {
          orderNo: makeOrderNo("ZH"),
          type: "RETURN",
          targetWarehouseId: warehouse.id,
          operatorId: input.operatorUserId,
          operatorName: input.operatorName,
          createdAt: time
        }
      });
      const existingByBarcode = new Map(existingItems.map((item) => [item.barcode, item]));
      const missingBarcodes = barcodes.filter((barcode) => !existingByBarcode.has(barcode));
      if (missingBarcodes.length > 0) {
        await tx.trackedBarcode.createMany({
          data: missingBarcodes.map((barcode) => ({
            barcode,
            currentOwnerType: "WAREHOUSE",
            warehouseId: warehouse.id,
            receiptStatus: "PENDING",
            status: "ACTIVE",
            lastMovedAt: time
          }))
        });
      }
      if (existingItems.length > 0) {
        const updated = await tx.trackedBarcode.updateMany({
          where: { id: { in: existingItems.map((item) => item.id) }, status: "ACTIVE", currentOwnerType: { not: "WAREHOUSE" } },
          data: {
            currentOwnerType: "WAREHOUSE",
            warehouseId: warehouse.id,
            salespersonId: null,
            terminalStoreName: null,
            lastMovedAt: time
          }
        });
        if (updated.count !== existingItems.length) throw new ApiError("部分条码已被其他设备处理，请重新校验", 409);
      }

      const persistedItems = await tx.trackedBarcode.findMany({ where: { barcode: { in: barcodes } } });
      const salespersonIds = Array.from(new Set(existingItems.flatMap((item) => item.salespersonId ? [item.salespersonId] : [])));
      const salespersonNames = new Map(
        (await tx.salesperson.findMany({ where: { id: { in: salespersonIds } }, select: { id: true, name: true } }))
          .map((person) => [person.id, person.name])
      );

      await tx.trackingOrderBarcode.createMany({
        data: persistedItems.map((item) => {
          const before = existingByBarcode.get(item.barcode);
          return {
            orderId: order.id,
            trackedBarcodeId: item.id,
            barcode: item.barcode,
            beforeOwnerType: before?.currentOwnerType,
            beforeWarehouseId: before?.warehouseId,
            beforeSalespersonId: before?.salespersonId,
            beforeTerminalStoreName: before?.terminalStoreName,
            beforeReceiptStatus: before?.receiptStatus,
            createdTrackingItem: !before
          };
        })
      });
      const movements = await tx.trackingMovement.createManyAndReturn({
        data: persistedItems.map((item) => {
          const before = existingByBarcode.get(item.barcode);
          return {
            trackedBarcodeId: item.id,
            barcode: item.barcode,
            type: "RETURN" as const,
            fromOwnerType: before?.currentOwnerType,
            toOwnerType: "WAREHOUSE" as const,
            fromLabel: trackingOwnerLabel(before, salespersonNames),
            toLabel: `仓库：${warehouse.name}`,
            operatorId: input.operatorUserId,
            operatorName: input.operatorName,
            occurredAt: time,
            note: "扫码回库，不要求商品、店铺或生产日期",
            orderId: order.id,
            orderNo: order.orderNo
          };
        })
      });
      await linkAndReconcileTrackedReceipts(
        tx,
        persistedItems.map((item) => ({ id: item.id, barcode: item.barcode }))
      );

      return {
        orderId: order.id,
        orderNo: order.orderNo,
        quantity: persistedItems.length,
        items: persistedItems.map(mapTrackedBarcode),
        movements: movements.map(mapTrackingMovement)
      };
    }
  );
}

export async function listTrackedBarcodes(input: {
  keyword?: string;
  receiptStatus?: string;
  ownerType?: string;
  warehouseId?: string;
  salespersonId?: string;
  page?: number;
  pageSize?: number;
}): Promise<TrackingBarcodeListResult> {
  const prisma = getPrisma();
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const where: Prisma.TrackedBarcodeWhereInput = { status: "ACTIVE" };
  const keyword = input.keyword?.trim();
  if (keyword) {
    where.OR = [
      { barcode: { contains: keyword, mode: "insensitive" } },
      { externalGoodsName: { contains: keyword, mode: "insensitive" } },
      { terminalStoreName: { contains: keyword, mode: "insensitive" } }
    ];
  }
  if (input.receiptStatus === "pending") where.receiptStatus = "PENDING";
  if (input.receiptStatus === "signed") where.receiptStatus = "SIGNED";
  if (input.receiptStatus === "exception") where.receiptStatus = "EXCEPTION";
  if (input.ownerType === "warehouse") {
    where.currentOwnerType = "WAREHOUSE";
    if (input.warehouseId && input.warehouseId !== "all") where.warehouseId = input.warehouseId;
  }
  if (input.ownerType === "salesperson") {
    where.currentOwnerType = "SALESPERSON";
    if (input.salespersonId && input.salespersonId !== "all") where.salespersonId = input.salespersonId;
  }
  if (input.ownerType === "terminal_store") where.currentOwnerType = "TERMINAL_STORE";

  const [total, items] = await Promise.all([
    prisma.trackedBarcode.count({ where }),
    prisma.trackedBarcode.findMany({
      where,
      orderBy: [{ lastMovedAt: "desc" }, { barcode: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);
  return { items: items.map(mapTrackedBarcode), total, page, pageSize };
}

export async function getTrackedBarcodeDetail(barcode: string): Promise<TrackingBarcodeDetail> {
  const prisma = getPrisma();
  const item = await prisma.trackedBarcode.findUnique({ where: { barcode: barcode.trim() } });
  if (!item) throw new ApiError(`条码 ${barcode} 不存在`, 404);
  const [movements, receipts] = await Promise.all([
    prisma.trackingMovement.findMany({ where: { trackedBarcodeId: item.id }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }] }),
    prisma.terminalReceiptRecord.findMany({ where: { trackedBarcodeId: item.id }, orderBy: [{ scannedAt: "desc" }, { id: "desc" }] })
  ]);
  return {
    item: mapTrackedBarcode(item),
    movements: movements.map(mapTrackingMovement),
    terminalReceipts: receipts.map((receipt) => ({
      id: receipt.id,
      barcode: receipt.barcode,
      scannedAt: formatAppDateTime(receipt.scannedAt),
      scannerName: receipt.scannerName,
      externalGoodsName: receipt.externalGoodsName,
      goodsUnit: receipt.goodsUnit,
      receivingOrganizationName: receipt.receivingOrganizationName,
      matchStatus: receipt.matchStatus === "MATCHED" ? "matched" : receipt.matchStatus === "CONFLICT" ? "conflict" : "unmatched",
      importedAt: formatAppDateTime(receipt.createdAt)
    }))
  };
}

export async function getTrackingSummary(): Promise<TrackingSummary> {
  const prisma = getPrisma();
  const active = { status: "ACTIVE" as const };
  const [total, pending, signed, exceptions, inWarehouses, withSalespeople, atTerminalStores, recentMovements, latestSync] =
    await Promise.all([
      prisma.trackedBarcode.count({ where: active }),
      prisma.trackedBarcode.count({ where: { ...active, receiptStatus: "PENDING" } }),
      prisma.trackedBarcode.count({ where: { ...active, receiptStatus: "SIGNED" } }),
      prisma.trackedBarcode.count({ where: { ...active, receiptStatus: "EXCEPTION" } }),
      prisma.trackedBarcode.count({ where: { ...active, currentOwnerType: "WAREHOUSE" } }),
      prisma.trackedBarcode.count({ where: { ...active, currentOwnerType: "SALESPERSON" } }),
      prisma.trackedBarcode.count({ where: { ...active, currentOwnerType: "TERMINAL_STORE" } }),
      prisma.trackingMovement.findMany({ orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 12 }),
      prisma.terminalReceiptSyncRun.findFirst({ orderBy: { startedAt: "desc" } })
    ]);
  return {
    total,
    pending,
    signed,
    exceptions,
    inWarehouses,
    withSalespeople,
    atTerminalStores,
    recentMovements: recentMovements.map(mapTrackingMovement),
    latestSync: latestSync ? {
      id: latestSync.id,
      trigger: latestSync.trigger === "MANUAL" ? "manual" : "scheduled",
      status: latestSync.status === "SUCCESS" ? "success" : latestSync.status === "FAILURE" ? "failure" : "running",
      logicalStartAt: formatAppDateTime(latestSync.logicalStartAt),
      logicalEndAt: formatAppDateTime(latestSync.logicalEndAt),
      exportStartDate: latestSync.exportStartDate.toISOString().slice(0, 10),
      exportEndDate: latestSync.exportEndDate.toISOString().slice(0, 10),
      externalFileName: latestSync.externalFileName ?? undefined,
      totalRows: latestSync.totalRows,
      importedRows: latestSync.importedRows,
      matchedRows: latestSync.matchedRows,
      unmatchedRows: latestSync.unmatchedRows,
      conflictRows: latestSync.conflictRows,
      duplicateRows: latestSync.duplicateRows,
      invalidRows: latestSync.invalidRows,
      operatorName: latestSync.operatorName,
      errorMessage: latestSync.errorMessage ?? undefined,
      startedAt: formatAppDateTime(latestSync.startedAt),
      finishedAt: latestSync.finishedAt ? formatAppDateTime(latestSync.finishedAt) : undefined
    } : undefined
  };
}

export async function listTrackingOrders(input: { page?: number; pageSize?: number; type?: string }): Promise<TrackingOrderListResult> {
  const prisma = getPrisma();
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const where: Prisma.TrackingOrderWhereInput = {};
  if (input.type === "sales_outbound") where.type = "SALES_OUTBOUND";
  if (input.type === "transfer") where.type = "TRANSFER";
  if (input.type === "return") where.type = "RETURN";
  const [total, orders] = await Promise.all([
    prisma.trackingOrder.count({ where }),
    prisma.trackingOrder.findMany({
      where,
      include: {
        items: { orderBy: { barcode: "asc" }, take: 4 },
        groupMembership: { include: { group: { select: { id: true, groupNo: true } } } },
        _count: { select: { items: true } }
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);
  return { items: orders.map(mapTrackingOrder), total, page, pageSize };
}

export async function getTrackingOrderDetail(orderId: string): Promise<TrackingOrderDetail> {
  const prisma = getPrisma();
  const order = await prisma.trackingOrder.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: { trackedBarcode: true },
        orderBy: { barcode: "asc" }
      },
      _count: { select: { items: true } }
    }
  });
  if (!order) throw new ApiError("流转单据不存在", 404);

  const trackedBarcodeIds = order.items.map((item) => item.trackedBarcodeId);
  const tracksTerminalReceipts = order.type === "SALES_OUTBOUND" || order.type === "TRANSFER";
  const [movements, receipts] = tracksTerminalReceipts && trackedBarcodeIds.length > 0
    ? await Promise.all([
        prisma.trackingMovement.findMany({
          where: {
            trackedBarcodeId: { in: trackedBarcodeIds },
            occurredAt: { gte: order.createdAt }
          },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }]
        }),
        prisma.terminalReceiptRecord.findMany({
          where: {
            trackedBarcodeId: { in: trackedBarcodeIds },
            scannedAt: { gte: order.createdAt }
          },
          orderBy: [{ scannedAt: "asc" }, { id: "asc" }]
        })
      ])
    : [[], []];

  const movementsByBarcode = new Map<string, typeof movements>();
  for (const movement of movements) {
    const entries = movementsByBarcode.get(movement.trackedBarcodeId) ?? [];
    entries.push(movement);
    movementsByBarcode.set(movement.trackedBarcodeId, entries);
  }
  const receiptsByBarcode = new Map<string, typeof receipts>();
  for (const receipt of receipts) {
    if (!receipt.trackedBarcodeId) continue;
    const entries = receiptsByBarcode.get(receipt.trackedBarcodeId) ?? [];
    entries.push(receipt);
    receiptsByBarcode.set(receipt.trackedBarcodeId, entries);
  }

  const items: TrackingOrderBarcodeDetail[] = order.items.map((orderItem) => {
    const tracked = orderItem.trackedBarcode;
    const currentOwner = {
      currentOwnerType: mapOwnerType(tracked.currentOwnerType),
      warehouseId: tracked.warehouseId ?? undefined,
      salespersonId: tracked.salespersonId ?? undefined,
      terminalStoreName: tracked.terminalStoreName ?? undefined
    };
    if (!tracksTerminalReceipts) {
      return {
        barcode: orderItem.barcode,
        externalGoodsName: tracked.externalGoodsName ?? undefined,
        goodsUnit: tracked.goodsUnit ?? undefined,
        ...currentOwner
      };
    }

    const itemMovements = movementsByBarcode.get(orderItem.trackedBarcodeId) ?? [];
    const startingMovement = itemMovements.find((movement) => movement.orderId === order.id);
    const cycleStartAt = startingMovement?.occurredAt ?? order.createdAt;
    const boundary = itemMovements.find((movement) =>
      movement.id !== startingMovement?.id &&
      movement.occurredAt.getTime() >= cycleStartAt.getTime() &&
      closesTrackingReceiptCycle(movement.type)
    );
    const cycleReceipts = (receiptsByBarcode.get(orderItem.trackedBarcodeId) ?? []).filter((receipt) =>
      receipt.scannedAt.getTime() >= cycleStartAt.getTime() &&
      (!boundary || receipt.scannedAt.getTime() < boundary.occurredAt.getTime())
    );
    const hasConflict = cycleReceipts.some((receipt) => receipt.matchStatus === "CONFLICT");
    const matchedReceipt = cycleReceipts.find((receipt) => receipt.matchStatus === "MATCHED");
    const latestReceipt = cycleReceipts.at(-1);
    const receiptStatus: TrackingReceiptStatus = hasConflict ? "exception" : matchedReceipt ? "signed" : "pending";

    return {
      barcode: orderItem.barcode,
      externalGoodsName: matchedReceipt?.externalGoodsName ?? tracked.externalGoodsName ?? undefined,
      goodsUnit: matchedReceipt?.goodsUnit ?? tracked.goodsUnit ?? undefined,
      receiptStatus,
      signedAt: latestReceipt ? formatAppDateTime(latestReceipt.scannedAt) : undefined,
      receivingOrganizationName: latestReceipt?.receivingOrganizationName,
      ...currentOwner
    };
  });

  const receiptSummary = tracksTerminalReceipts
    ? summarizeTrackingOrderReceipts(items)
    : undefined;
  const goodsReceiptSummaries = tracksTerminalReceipts
    ? summarizeTrackingOrderGoodsReceipts(items)
    : [];

  return {
    order: mapTrackingOrder(order),
    receiptSummary,
    goodsReceiptSummaries,
    items
  };
}

function closesTrackingReceiptCycle(type: "LEGACY_INBOUND" | "SALES_OUTBOUND" | "TRANSFER" | "RETURN" | "QINCE_RECEIPT" | "ORDER_REVERSAL" | "BARCODE_CORRECTION" | "WRITE_OFF") {
  return type === "SALES_OUTBOUND" ||
    type === "TRANSFER" ||
    type === "RETURN" ||
    type === "ORDER_REVERSAL" ||
    type === "WRITE_OFF";
}

export function summarizeTrackingOrderReceipts(items: TrackingOrderBarcodeDetail[]) {
  const signed = items.filter((item) => item.receiptStatus === "signed").length;
  const exceptions = items.filter((item) => item.receiptStatus === "exception").length;
  const pending = items.length - signed - exceptions;
  return {
    total: items.length,
    signed,
    pending,
    exceptions,
    signedRate: receiptRate(signed, items.length)
  };
}

export function summarizeTrackingOrderGoodsReceipts(items: TrackingOrderBarcodeDetail[]): TrackingOrderGoodsReceiptSummary[] {
  const grouped = new Map<string, TrackingOrderGoodsReceiptSummary>();
  for (const item of items) {
    const goodsName = item.externalGoodsName?.trim() || "待勤策补全";
    const goodsUnit = item.goodsUnit?.trim() || undefined;
    const key = `${goodsName}\u0000${goodsUnit ?? ""}`;
    const summary = grouped.get(key) ?? {
      goodsName,
      goodsUnit,
      total: 0,
      signed: 0,
      pending: 0,
      exceptions: 0,
      signedRate: 0
    };
    summary.total += 1;
    if (item.receiptStatus === "signed") summary.signed += 1;
    else if (item.receiptStatus === "exception") summary.exceptions += 1;
    else summary.pending += 1;
    summary.signedRate = receiptRate(summary.signed, summary.total);
    grouped.set(key, summary);
  }
  return Array.from(grouped.values()).sort((left, right) => {
    if (left.goodsName === "待勤策补全") return 1;
    if (right.goodsName === "待勤策补全") return -1;
    return left.goodsName.localeCompare(right.goodsName, "zh-CN");
  });
}

function receiptRate(signed: number, total: number) {
  return total === 0 ? 0 : Math.round((signed / total) * 1000) / 10;
}

function normalizeBarcodes(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizePage(value?: number) {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 1;
}

function normalizePageSize(value?: number) {
  if (!Number.isFinite(value) || !value) return 20;
  return Math.min(100, Math.max(1, Math.floor(value)));
}

function makeOrderNo(prefix: string) {
  return `${prefix}${Date.now()}${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function mapOwnerType(value: "WAREHOUSE" | "SALESPERSON" | "TERMINAL_STORE"): OwnerType {
  return value === "WAREHOUSE" ? "warehouse" : value === "SALESPERSON" ? "salesperson" : "terminal_store";
}

export function mapTrackedBarcode(item: {
  id: string;
  barcode: string;
  externalGoodsName: string | null;
  goodsUnit: string | null;
  currentOwnerType: "WAREHOUSE" | "SALESPERSON" | "TERMINAL_STORE";
  warehouseId: string | null;
  salespersonId: string | null;
  terminalStoreName: string | null;
  receiptStatus: "PENDING" | "SIGNED" | "EXCEPTION";
  status: "ACTIVE" | "WRITTEN_OFF" | "VOIDED";
  signedAt: Date | null;
  lastMovedAt: Date;
}): TrackedBarcode {
  return {
    id: item.id,
    barcode: item.barcode,
    externalGoodsName: item.externalGoodsName ?? undefined,
    goodsUnit: item.goodsUnit ?? undefined,
    currentOwnerType: mapOwnerType(item.currentOwnerType),
    warehouseId: item.warehouseId ?? undefined,
    salespersonId: item.salespersonId ?? undefined,
    terminalStoreName: item.terminalStoreName ?? undefined,
    receiptStatus: item.receiptStatus === "SIGNED" ? "signed" : item.receiptStatus === "EXCEPTION" ? "exception" : "pending",
    status: item.status === "WRITTEN_OFF" ? "written_off" : item.status === "VOIDED" ? "voided" : "active",
    signedAt: item.signedAt ? formatAppDateTime(item.signedAt) : undefined,
    lastMovedAt: formatAppDateTime(item.lastMovedAt)
  };
}

export function mapTrackingMovement(movement: {
  id: string;
  barcode: string;
  type: "LEGACY_INBOUND" | "SALES_OUTBOUND" | "TRANSFER" | "RETURN" | "QINCE_RECEIPT" | "ORDER_REVERSAL" | "BARCODE_CORRECTION" | "WRITE_OFF";
  fromOwnerType: "WAREHOUSE" | "SALESPERSON" | "TERMINAL_STORE" | null;
  toOwnerType: "WAREHOUSE" | "SALESPERSON" | "TERMINAL_STORE";
  fromLabel: string;
  toLabel: string;
  operatorName: string;
  occurredAt: Date;
  note: string;
  orderId: string | null;
  orderNo: string | null;
}): TrackingMovement {
  const types = {
    LEGACY_INBOUND: "legacy_inbound",
    SALES_OUTBOUND: "sales_outbound",
    TRANSFER: "transfer",
    RETURN: "return",
    QINCE_RECEIPT: "qince_receipt",
    ORDER_REVERSAL: "order_reversal",
    BARCODE_CORRECTION: "barcode_correction",
    WRITE_OFF: "write_off"
  } as const;
  return {
    id: movement.id,
    barcode: movement.barcode,
    type: types[movement.type],
    fromOwnerType: movement.fromOwnerType ? mapOwnerType(movement.fromOwnerType) : undefined,
    toOwnerType: mapOwnerType(movement.toOwnerType),
    fromLabel: movement.fromLabel,
    toLabel: movement.toLabel,
    operator: movement.operatorName,
    occurredAt: formatAppDateTime(movement.occurredAt),
    note: movement.note,
    orderId: movement.orderId ?? undefined,
    orderNo: movement.orderNo ?? undefined
  };
}

function mapTrackingOrder(order: {
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
  groupMembership?: { group: { id: string; groupNo: string } } | null;
}): TrackingOrderSummary {
  return {
    id: order.id,
    orderNo: order.orderNo,
    type: order.type === "SALES_OUTBOUND" ? "sales_outbound" : order.type === "TRANSFER" ? "transfer" : "return",
    sourceWarehouseId: order.sourceWarehouseId ?? undefined,
    targetWarehouseId: order.targetWarehouseId ?? undefined,
    salespersonId: order.salespersonId ?? undefined,
    operator: order.operatorName,
    createdAt: formatAppDateTime(order.createdAt),
    barcodeCount: order._count.items,
    barcodePreview: order.items.map((item) => item.barcode),
    status: order.status === "VOIDED" ? "voided" : "active",
    groupId: order.groupMembership?.group.id,
    groupNo: order.groupMembership?.group.groupNo
  };
}

function trackingOwnerLabel(
  item: { currentOwnerType: "WAREHOUSE" | "SALESPERSON" | "TERMINAL_STORE"; salespersonId: string | null; terminalStoreName: string | null } | undefined,
  salespersonNames: Map<string, string>
) {
  if (!item) return "外部流入";
  if (item.currentOwnerType === "SALESPERSON") return `销售人员：${salespersonNames.get(item.salespersonId ?? "") ?? "未知"}`;
  if (item.currentOwnerType === "TERMINAL_STORE") return `终端店铺：${item.terminalStoreName ?? "未知"}`;
  return "仓库";
}
