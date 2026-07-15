import type { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/db";
import { adjustWarehouseStock } from "@/lib/services/warehouse-stock-service";
import type { CurrentUser, OrderKind } from "@/lib/types";

export type VoidOrderReference = {
  id: string;
  kind: OrderKind;
};

export type VoidOrdersInput = {
  orders: VoidOrderReference[];
  reason: string;
  user: CurrentUser;
};

export async function voidOrders(input: VoidOrdersInput) {
  const orders = uniqueOrderReferences(input.orders);
  if (orders.length === 0) throw new Error("请选择需要撤销的单据");
  if (orders.length > 50) throw new Error("单次最多撤销 50 张单据");
  const reason = normalizeReason(input.reason);
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const results: Array<{ id: string; kind: OrderKind; orderNo: string }> = [];
    for (const order of orders) {
      if (order.kind === "inbound") {
        results.push(await voidInboundOrder(tx, order.id, reason, input.user));
      } else if (order.kind === "outbound") {
        results.push(await voidOutboundOrder(tx, order.id, reason, input.user));
      } else {
        results.push(await voidSalesReturnOrder(tx, order.id, reason, input.user));
      }
    }
    return { voided: results.length, orders: results };
  });
}

async function voidInboundOrder(tx: Prisma.TransactionClient, id: string, reason: string, user: CurrentUser) {
  const order = await tx.inboundOrder.findUnique({
    where: { id },
    include: { warehouse: true, location: true, items: { include: { inventoryItem: true } } }
  });
  assertOrderCanBeVoided(order, "入库单");
  if (!order) throw new Error("入库单不存在");
  const time = new Date();

  if (order.source === "FACTORY") {
    for (const [goodsId, quantity] of groupQuantities(order.items)) {
      await adjustWarehouseStock(tx, {
        warehouseId: order.warehouseId,
        goodsId,
        quantityChange: -quantity,
        type: "ORDER_REVERSAL",
        orderKind: "inbound",
        orderId: order.id,
        orderNo: order.orderNo,
        counterparty: `撤销厂家到货入库单 ${order.orderNo}`,
        operatorName: user.displayName,
        occurredAt: time,
        note: reversalNote(order.orderNo, order.operatorName, user.displayName, reason)
      });
    }
  } else {
    const trackedItems = order.items.filter((line) => line.inventoryItem).map((line) => ({ line, item: line.inventoryItem! }));
    await assertNoLaterMovements(tx, trackedItems.map(({ item }) => item.id), order.id, order.orderNo);
    const conflict = trackedItems.find(
      ({ item }) => item.status !== "IN_STOCK" || item.warehouseId !== order.warehouseId
    );
    if (conflict) throw new Error(`条码 ${conflict.item.barcode} 已不在原入库仓库，不能撤销`);

    for (const [goodsId, quantity] of groupQuantities(order.items)) {
      await adjustWarehouseStock(tx, {
        warehouseId: order.warehouseId,
        goodsId,
        quantityChange: -quantity,
        type: "ORDER_REVERSAL",
        orderKind: "inbound",
        orderId: order.id,
        orderNo: order.orderNo,
        counterparty: `撤销终端退换货入库单 ${order.orderNo}`,
        operatorName: user.displayName,
        occurredAt: time,
        note: reversalNote(order.orderNo, order.operatorName, user.displayName, reason)
      });
    }

    const salespersonNames = await salespersonNameMap(
      tx,
      trackedItems.map(({ line }) => line.beforeSalespersonId).filter((value): value is string => Boolean(value))
    );
    const latestByItem = await latestMovementMap(tx, trackedItems.map(({ item }) => item.id));
    for (const { line, item } of trackedItems) {
      const toLabel = line.createdTrackingItem
        ? `撤销追踪：${order.orderNo}`
        : snapshotLabel(line, order.warehouse.name, order.location.name, salespersonNames);
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: line.createdTrackingItem
          ? { status: "VOIDED", lastMovedAt: time }
          : restoreSnapshot(line, time)
      });
      await tx.stockMovement.create({
        data: {
          itemId: item.id,
          barcode: item.barcode,
          goodsId: item.goodsId,
          type: "ORDER_REVERSAL",
          fromLabel: `${order.warehouse.name} / ${order.location.name}`,
          toLabel,
          operatorName: user.displayName,
          occurredAt: time,
          note: reversalNote(order.orderNo, order.operatorName, user.displayName, reason),
          orderKind: "inbound",
          orderId: order.id,
          orderNo: order.orderNo,
          reversalOfMovementId: latestByItem.get(item.id)?.id
        }
      });
    }
  }

  await tx.inboundOrder.update({ where: { id }, data: voidData(user, reason, time) });
  return { id, kind: "inbound" as const, orderNo: order.orderNo };
}

async function voidOutboundOrder(tx: Prisma.TransactionClient, id: string, reason: string, user: CurrentUser) {
  const order = await tx.outboundOrder.findUnique({
    where: { id },
    include: {
      sourceWarehouse: true,
      targetWarehouse: true,
      targetLocation: true,
      salesperson: true,
      items: { include: { inventoryItem: true } }
    }
  });
  assertOrderCanBeVoided(order, "出库单");
  if (!order) throw new Error("出库单不存在");

  await assertNoLaterMovements(tx, order.items.map((line) => line.inventoryItemId), order.id, order.orderNo);
  const conflict = order.items.find((line) => {
    const item = line.inventoryItem;
    if (order.type === "TRANSFER") {
      return item.status !== "IN_STOCK" || item.warehouseId !== order.targetWarehouseId;
    }
    return item.status !== "WITH_SALESPERSON" || item.salespersonId !== order.salespersonId;
  });
  if (conflict) throw new Error(`条码 ${conflict.barcode} 已发生后续归属变化，不能撤销`);

  const time = new Date();
  for (const [goodsId, quantity] of groupQuantities(order.items.map((line) => ({ ...line, quantity: 1 })))) {
    await adjustWarehouseStock(tx, {
      warehouseId: order.sourceWarehouseId,
      goodsId,
      quantityChange: quantity,
      type: "ORDER_REVERSAL",
      orderKind: "outbound",
      orderId: order.id,
      orderNo: order.orderNo,
      counterparty: `撤销出库单 ${order.orderNo}`,
      operatorName: user.displayName,
      occurredAt: time,
      note: reversalNote(order.orderNo, order.operatorName, user.displayName, reason)
    });
    if (order.type === "TRANSFER" && order.targetWarehouseId) {
      await adjustWarehouseStock(tx, {
        warehouseId: order.targetWarehouseId,
        goodsId,
        quantityChange: -quantity,
        type: "ORDER_REVERSAL",
        orderKind: "outbound",
        orderId: order.id,
        orderNo: order.orderNo,
        counterparty: `撤销挪仓单 ${order.orderNo}`,
        operatorName: user.displayName,
        occurredAt: time,
        note: reversalNote(order.orderNo, order.operatorName, user.displayName, reason)
      });
    }
  }

  const latestByItem = await latestMovementMap(tx, order.items.map((line) => line.inventoryItemId));
  const sourceLocationIds = order.items
    .map((line) => line.beforeLocationId)
    .filter((value): value is string => Boolean(value));
  const sourceLocations = new Map(
    (await tx.storageLocation.findMany({ where: { id: { in: sourceLocationIds } } })).map((location) => [location.id, location.name])
  );
  for (const line of order.items) {
    const item = line.inventoryItem;
    const sourceLocationName = line.beforeLocationId ? sourceLocations.get(line.beforeLocationId) : undefined;
    const sourceLabel = `${order.sourceWarehouse.name}${sourceLocationName ? ` / ${sourceLocationName}` : ""}`;
    const destinationLabel =
      order.type === "TRANSFER"
        ? `${order.targetWarehouse?.name ?? "目标仓库"}${order.targetLocation ? ` / ${order.targetLocation.name}` : ""}`
        : `销售人员：${order.salesperson?.name ?? "未知"}`;

    await tx.inventoryItem.update({
      where: { id: item.id },
      data: line.createdTrackingItem
        ? {
            ownerType: "WAREHOUSE",
            warehouseId: order.sourceWarehouseId,
            locationId: line.beforeLocationId,
            salespersonId: null,
            status: "VOIDED",
            lastMovedAt: time
          }
        : restoreSnapshot(line, time)
    });
    await tx.stockMovement.create({
      data: {
        itemId: item.id,
        barcode: item.barcode,
        goodsId: item.goodsId,
        type: "ORDER_REVERSAL",
        fromLabel: destinationLabel,
        toLabel: line.createdTrackingItem ? `撤销追踪：${order.orderNo}` : sourceLabel,
        operatorName: user.displayName,
        occurredAt: time,
        note: reversalNote(order.orderNo, order.operatorName, user.displayName, reason),
        orderKind: "outbound",
        orderId: order.id,
        orderNo: order.orderNo,
        reversalOfMovementId: latestByItem.get(item.id)?.id
      }
    });
  }

  await tx.outboundOrder.update({ where: { id }, data: voidData(user, reason, time) });
  return { id, kind: "outbound" as const, orderNo: order.orderNo };
}

async function voidSalesReturnOrder(tx: Prisma.TransactionClient, id: string, reason: string, user: CurrentUser) {
  const order = await tx.salesReturnOrder.findUnique({
    where: { id },
    include: {
      returnWarehouse: true,
      returnLocation: true,
      items: { include: { inventoryItem: true, fromSalesperson: true } }
    }
  });
  assertOrderCanBeVoided(order, "销售退回单");
  if (!order) throw new Error("销售退回单不存在");
  await assertNoLaterMovements(tx, order.items.map((line) => line.inventoryItemId), order.id, order.orderNo);
  const conflict = order.items.find(
    (line) => line.inventoryItem.status !== "IN_STOCK" || line.inventoryItem.warehouseId !== order.returnWarehouseId
  );
  if (conflict) throw new Error(`条码 ${conflict.barcode} 已不在原退回仓库，不能撤销`);

  const time = new Date();
  for (const [goodsId, quantity] of groupQuantities(order.items.map((line) => ({ ...line, quantity: 1 })))) {
    await adjustWarehouseStock(tx, {
      warehouseId: order.returnWarehouseId,
      goodsId,
      quantityChange: -quantity,
      type: "ORDER_REVERSAL",
      orderKind: "sales_return",
      orderId: order.id,
      orderNo: order.orderNo,
      counterparty: `撤销销售退回单 ${order.orderNo}`,
      operatorName: user.displayName,
      occurredAt: time,
      note: reversalNote(order.orderNo, order.operatorName, user.displayName, reason)
    });
  }

  const latestByItem = await latestMovementMap(tx, order.items.map((line) => line.inventoryItemId));
  for (const line of order.items) {
    const salespersonId = line.beforeSalespersonId ?? line.fromSalespersonId;
    await tx.inventoryItem.update({
      where: { id: line.inventoryItemId },
      data: {
        ownerType: "SALESPERSON",
        warehouseId: null,
        locationId: null,
        salespersonId,
        terminalStoreName: null,
        signedAt: null,
        status: "WITH_SALESPERSON",
        lastMovedAt: time
      }
    });
    await tx.stockMovement.create({
      data: {
        itemId: line.inventoryItemId,
        barcode: line.inventoryItem.barcode,
        goodsId: line.goodsId,
        type: "ORDER_REVERSAL",
        fromLabel: `${order.returnWarehouse.name} / ${order.returnLocation.name}`,
        toLabel: `销售人员：${line.fromSalesperson.name}`,
        operatorName: user.displayName,
        occurredAt: time,
        note: reversalNote(order.orderNo, order.operatorName, user.displayName, reason),
        orderKind: "sales_return",
        orderId: order.id,
        orderNo: order.orderNo,
        reversalOfMovementId: latestByItem.get(line.inventoryItemId)?.id
      }
    });
  }

  await tx.salesReturnOrder.update({ where: { id }, data: voidData(user, reason, time) });
  return { id, kind: "sales_return" as const, orderNo: order.orderNo };
}

function assertOrderCanBeVoided(order: { status: string; reversalSupported: boolean; orderNo: string } | null, label: string) {
  if (!order) throw new Error(`${label}不存在`);
  if (order.status === "VOIDED") throw new Error(`${label} ${order.orderNo} 已经撤销`);
  if (!order.reversalSupported) throw new Error(`${label} ${order.orderNo} 创建于旧版本，缺少撤销所需的归属快照`);
}

async function assertNoLaterMovements(
  tx: Prisma.TransactionClient,
  itemIds: string[],
  orderId: string,
  orderNo: string
) {
  const latest = await latestMovementMap(tx, itemIds);
  const conflict = itemIds.find((itemId) => latest.get(itemId)?.orderId !== orderId);
  if (conflict) {
    const movement = latest.get(conflict);
    throw new Error(`条码 ${movement?.barcode ?? conflict} 在单据 ${orderNo} 后已有新的流转，不能撤销`);
  }
  const orderMovements = await tx.stockMovement.findMany({
    where: { itemId: { in: itemIds }, orderId },
    select: { itemId: true, occurredAt: true }
  });
  const orderTimeByItem = new Map(orderMovements.map((movement) => [movement.itemId, movement.occurredAt]));
  const laterReceipt = await tx.terminalReceiptRecord.findFirst({
    where: {
      inventoryItemId: { in: itemIds },
      OR: itemIds.flatMap((itemId) => {
        const occurredAt = orderTimeByItem.get(itemId);
        return occurredAt ? [{ inventoryItemId: itemId, scannedAt: { gt: occurredAt } }] : [];
      })
    },
    orderBy: { scannedAt: "asc" }
  });
  if (laterReceipt) {
    throw new Error(`条码 ${laterReceipt.barcode} 在单据 ${orderNo} 后已有终端签收记录，不能撤销`);
  }
}

async function latestMovementMap(tx: Prisma.TransactionClient, itemIds: string[]) {
  if (itemIds.length === 0) return new Map<string, { id: string; itemId: string; orderId: string | null; barcode: string }>();
  const movements = await tx.stockMovement.findMany({
    where: { itemId: { in: itemIds } },
    orderBy: [{ itemId: "asc" }, { occurredAt: "desc" }],
    select: { id: true, itemId: true, orderId: true, barcode: true }
  });
  const latest = new Map<string, (typeof movements)[number]>();
  for (const movement of movements) if (!latest.has(movement.itemId)) latest.set(movement.itemId, movement);
  return latest;
}

function groupQuantities(items: Array<{ goodsId: string; quantity: number }>) {
  const grouped = new Map<string, number>();
  for (const item of items) grouped.set(item.goodsId, (grouped.get(item.goodsId) ?? 0) + item.quantity);
  return grouped;
}

function restoreSnapshot(
  snapshot: {
    beforeOwnerType: "WAREHOUSE" | "SALESPERSON" | "TERMINAL_STORE" | null;
    beforeWarehouseId: string | null;
    beforeLocationId: string | null;
    beforeSalespersonId: string | null;
    beforeTerminalStoreName: string | null;
    beforeSignedAt: Date | null;
  },
  time: Date
): Prisma.InventoryItemUncheckedUpdateInput {
  if (snapshot.beforeOwnerType === "SALESPERSON" && snapshot.beforeSalespersonId) {
    return {
      ownerType: "SALESPERSON",
      warehouseId: null,
      locationId: null,
      salespersonId: snapshot.beforeSalespersonId,
      terminalStoreName: null,
      signedAt: null,
      status: "WITH_SALESPERSON",
      lastMovedAt: time
    };
  }
  if (snapshot.beforeOwnerType === "WAREHOUSE" && snapshot.beforeWarehouseId) {
    return {
      ownerType: "WAREHOUSE",
      warehouseId: snapshot.beforeWarehouseId,
      locationId: snapshot.beforeLocationId,
      salespersonId: null,
      terminalStoreName: null,
      signedAt: null,
      status: "IN_STOCK",
      lastMovedAt: time
    };
  }
  if (snapshot.beforeOwnerType === "TERMINAL_STORE" && snapshot.beforeTerminalStoreName) {
    return {
      ownerType: "TERMINAL_STORE",
      warehouseId: null,
      locationId: null,
      salespersonId: null,
      terminalStoreName: snapshot.beforeTerminalStoreName,
      signedAt: snapshot.beforeSignedAt,
      status: "SIGNED",
      lastMovedAt: time
    };
  }
  throw new Error("单据缺少原归属快照，不能撤销");
}

function snapshotLabel(
  snapshot: { beforeOwnerType: string | null; beforeSalespersonId: string | null; beforeTerminalStoreName?: string | null },
  warehouseName: string,
  locationName: string,
  salespersonNames: Map<string, string>
) {
  if (snapshot.beforeOwnerType === "SALESPERSON" && snapshot.beforeSalespersonId) {
    return `销售人员：${salespersonNames.get(snapshot.beforeSalespersonId) ?? "未知"}`;
  }
  if (snapshot.beforeOwnerType === "TERMINAL_STORE") {
    return `终端店铺：${snapshot.beforeTerminalStoreName ?? "未知"}`;
  }
  return `${warehouseName} / ${locationName}`;
}

async function salespersonNameMap(tx: Prisma.TransactionClient, ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return new Map<string, string>();
  const rows = await tx.salesperson.findMany({ where: { id: { in: uniqueIds } }, select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.id, row.name]));
}

function voidData(user: CurrentUser, reason: string, time: Date) {
  return {
    status: "VOIDED" as const,
    voidedAt: time,
    voidedByUserId: user.id,
    voidedByName: user.displayName,
    voidReason: reason
  };
}

function reversalNote(orderNo: string, originalOperator: string, voidedBy: string, reason: string) {
  return `撤销单据 ${orderNo}；原操作人：${originalOperator}；撤销人：${voidedBy}；原因：${reason}`;
}

function normalizeReason(value: string) {
  const reason = value?.trim();
  if (!reason || reason.length < 2) throw new Error("请填写至少 2 个字符的撤销原因");
  if (reason.length > 200) throw new Error("撤销原因不能超过 200 个字符");
  return reason;
}

function uniqueOrderReferences(input: VoidOrderReference[]) {
  const seen = new Set<string>();
  return input.filter((order) => {
    if (!order?.id || !["inbound", "outbound", "sales_return"].includes(order.kind)) return false;
    const key = `${order.kind}:${order.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
