import type { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/db";
import { adjustWarehouseStock } from "@/lib/services/warehouse-stock-service";
import { formatAppDateTime } from "@/lib/warehouse-utils";
import type { InventoryItem, MovementType, OutboundType, StockMovement } from "@/lib/types";

type DbOutboundType = "TRANSFER" | "SALES";
type DbInboundSource = "FACTORY" | "TERMINAL_RETURN";
type DbMovementType = "FACTORY_INBOUND" | "TERMINAL_RETURN_INBOUND" | "TRANSFER" | "SALES_OUTBOUND" | "SALES_RETURN";

type DbInventoryItem = {
  id: string;
  barcode: string;
  goodsId: string;
  ownerType: "WAREHOUSE" | "SALESPERSON";
  warehouseId: string | null;
  locationId: string | null;
  salespersonId: string | null;
  status: "IN_STOCK" | "WITH_SALESPERSON";
  productionDate: Date | null;
  shelfLifeDate: Date | null;
  inboundSource: DbInboundSource;
  lastMovedAt: Date;
};

type DbStockMovement = {
  id: string;
  itemId: string;
  barcode: string;
  goodsId: string;
  type: DbMovementType;
  fromLabel: string;
  toLabel: string;
  operatorName: string;
  occurredAt: Date;
  note: string;
};

export type SubmitOutboundLineInput = {
  goodsId: string;
  targetQuantity?: number;
  barcodes: string[];
};

type NormalizedOutboundLine = {
  goodsId: string;
  targetQuantity?: number;
  barcodes: string[];
};

export type SubmitOutboundInput = {
  type: OutboundType;
  sourceWarehouseId: string;
  targetWarehouseId?: string;
  targetLocationId?: string;
  salespersonId?: string;
  goodsId?: string;
  barcodes?: string[];
  lines?: SubmitOutboundLineInput[];
  operatorName: string;
};

export async function submitOutbound(input: SubmitOutboundInput) {
  const lines = normalizeOutboundLines(input);
  const barcodes = lines.flatMap((line) => line.barcodes);

  if (barcodes.length === 0) {
    throw new Error("请先扫描或录入条码");
  }

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const goodsIds = Array.from(new Set(lines.map((line) => line.goodsId)));
    const [sourceWarehouse, goodsRecords] = await Promise.all([
      tx.warehouse.findUnique({ where: { id: input.sourceWarehouseId } }),
      tx.goods.findMany({ where: { id: { in: goodsIds } } })
    ]);
    if (!sourceWarehouse) throw new Error("请选择有效的出库仓库");
    const goodsById = new Map(goodsRecords.map((goods) => [goods.id, goods]));
    const missingGoodsId = goodsIds.find((goodsId) => !goodsById.has(goodsId));
    if (missingGoodsId) throw new Error("请选择有效的货物");
    const time = new Date();

    const sourceLocation = await tx.storageLocation.findFirst({
      where: { warehouseId: sourceWarehouse.id, status: "ENABLED" },
      orderBy: { createdAt: "asc" }
    });
    if (!sourceLocation) throw new Error("出库仓库缺少可用默认库位");

    const destinationType: "transfer" | "sales" = input.targetWarehouseId ? "transfer" : "sales";
    const targetWarehouse = input.targetWarehouseId
      ? await tx.warehouse.findUnique({ where: { id: input.targetWarehouseId } })
      : null;
    const targetLocation = targetWarehouse
      ? input.targetLocationId
        ? await tx.storageLocation.findUnique({ where: { id: input.targetLocationId } })
        : await tx.storageLocation.findFirst({
            where: { warehouseId: targetWarehouse.id, status: "ENABLED" },
            orderBy: { createdAt: "asc" }
          })
      : null;
    const salesperson = input.salespersonId
      ? await tx.salesperson.findUnique({ where: { id: input.salespersonId } })
      : null;

    if (destinationType === "transfer") {
      if (!targetWarehouse) throw new Error("挪仓必须选择目标仓库");
      if (targetWarehouse.id === sourceWarehouse.id) throw new Error("目标仓库不能与出库仓库相同");
      if (!targetLocation || targetLocation.warehouseId !== targetWarehouse.id) throw new Error("请选择有效的目标库位");
    }

    if (destinationType === "sales" && !salesperson) {
      throw new Error("扫码出库分配销售时必须选择销售人员");
    }

    const items = await tx.inventoryItem.findMany({
      where: { barcode: { in: barcodes } },
      orderBy: { barcode: "asc" }
    });
    const itemByBarcode = new Map(items.map((item) => [item.barcode, item]));
    const lineByBarcode = new Map(lines.flatMap((line) => line.barcodes.map((barcode) => [barcode, line] as const)));
    const goodsMismatch = items.find((item) => lineByBarcode.get(item.barcode)?.goodsId !== item.goodsId);
    if (goodsMismatch) throw new Error(`条码 ${goodsMismatch.barcode} 已绑定其他货物，不能按当前货物出库`);
    const invalid = items.find(
      (item) => item.ownerType !== "WAREHOUSE" || item.warehouseId !== sourceWarehouse.id
    );
    if (invalid) throw new Error(`条码 ${invalid.barcode} 当前不在所选出库仓库`);

    const order = await tx.outboundOrder.create({
      data: {
        orderNo: makeOrderNo("CK"),
        type: toDbOutboundType(destinationType),
        sourceWarehouseId: sourceWarehouse.id,
        targetWarehouseId: destinationType === "transfer" ? targetWarehouse?.id : undefined,
        targetLocationId: destinationType === "transfer" ? targetLocation?.id : undefined,
        salespersonId: destinationType === "sales" ? salesperson?.id : undefined,
        operatorName: input.operatorName,
        createdAt: time
      }
    });

    for (const line of lines) {
      const goods = goodsById.get(line.goodsId);
      if (!goods) throw new Error("请选择有效的货物");
      await adjustWarehouseStock(tx, {
        warehouseId: sourceWarehouse.id,
        goodsId: goods.id,
        quantityChange: -line.barcodes.length,
        type: destinationType === "transfer" ? "TRANSFER" : "SALES_OUTBOUND",
        orderKind: "outbound",
        orderId: order.id,
        counterparty:
          destinationType === "transfer" ? targetWarehouse?.name ?? "目标仓库" : `销售人员：${salesperson?.name ?? "未知"}`,
        operatorName: input.operatorName,
        occurredAt: time,
        note: destinationType === "transfer" ? "扫码出库发往仓库" : "扫码出库分配销售"
      });
      if (destinationType === "transfer" && targetWarehouse) {
        await adjustWarehouseStock(tx, {
          warehouseId: targetWarehouse.id,
          goodsId: goods.id,
          quantityChange: line.barcodes.length,
          type: "TRANSFER",
          orderKind: "outbound",
          orderId: order.id,
          counterparty: sourceWarehouse.name,
          operatorName: input.operatorName,
          occurredAt: time,
          note: "扫码出库到达仓库"
        });
      }
    }

    const updatedItems: InventoryItem[] = [];
    const movements: StockMovement[] = [];

    for (const line of lines) {
      const goods = goodsById.get(line.goodsId);
      if (!goods) throw new Error("请选择有效的货物");

      for (const barcode of line.barcodes) {
        const item =
          itemByBarcode.get(barcode) ??
          (await tx.inventoryItem.create({
            data: {
              barcode,
              goodsId: goods.id,
              ownerType: "WAREHOUSE",
              warehouseId: sourceWarehouse.id,
              locationId: sourceLocation.id,
              status: "IN_STOCK",
              productionDate: null,
              shelfLifeDate: null,
              inboundSource: "FACTORY",
              lastMovedAt: time
            }
          }));

        const fromLabel = await warehouseLabel(tx, item.warehouseId, item.locationId);
        const toLabel =
          destinationType === "transfer"
            ? `${targetWarehouse?.name ?? "目标仓库"} / ${targetLocation?.name ?? "默认库位"}`
            : `销售人员：${salesperson?.name ?? "未知"}`;

        const updated = await tx.inventoryItem.update({
          where: { id: item.id },
          data:
            destinationType === "transfer"
              ? {
                  ownerType: "WAREHOUSE",
                  warehouseId: targetWarehouse?.id,
                  locationId: targetLocation?.id,
                  salespersonId: null,
                  status: "IN_STOCK",
                  lastMovedAt: time
                }
              : {
                  ownerType: "SALESPERSON",
                  warehouseId: null,
                  locationId: null,
                  salespersonId: salesperson?.id,
                  status: "WITH_SALESPERSON",
                  lastMovedAt: time
                }
        });

        const movement = await tx.stockMovement.create({
          data: {
            itemId: updated.id,
            barcode: updated.barcode,
            goodsId: updated.goodsId,
            type: destinationType === "transfer" ? "TRANSFER" : "SALES_OUTBOUND",
            fromLabel,
            toLabel,
            operatorName: input.operatorName,
            occurredAt: time,
            note: destinationType === "transfer" ? "扫码出库发往仓库" : "扫码出库分配销售"
          }
        });

        await tx.outboundOrderItem.create({
          data: {
            orderId: order.id,
            inventoryItemId: updated.id,
            barcode: updated.barcode,
            goodsId: updated.goodsId
          }
        });

        updatedItems.push(mapInventoryItem(updated));
        movements.push(mapStockMovement(movement));
      }
    }

    return { orderId: order.id, items: updatedItems, movements };
  });
}

function normalizeOutboundLines(input: SubmitOutboundInput): NormalizedOutboundLine[] {
  const rawLines =
    Array.isArray(input.lines) && input.lines.length > 0
      ? input.lines
      : input.goodsId
        ? [{ goodsId: input.goodsId, barcodes: input.barcodes ?? [] }]
        : [];

  const seenBarcodes = new Set<string>();
  const normalized: NormalizedOutboundLine[] = [];

  for (const rawLine of rawLines) {
    const goodsId = rawLine.goodsId?.trim();
    if (!goodsId) {
      throw new Error("每个出库货品行都必须选择货物");
    }

    const lineBarcodes = Array.from(new Set((rawLine.barcodes ?? []).map((barcode) => barcode.trim()).filter(Boolean)));
    const targetQuantity = normalizeTargetQuantity(rawLine.targetQuantity);

    if (targetQuantity !== undefined && lineBarcodes.length !== targetQuantity) {
      throw new Error(`货品行目标数量为 ${targetQuantity} 件，当前已扫 ${lineBarcodes.length} 件`);
    }

    for (const barcode of lineBarcodes) {
      if (seenBarcodes.has(barcode)) {
        throw new Error(`条码 ${barcode} 在多个货品行中重复`);
      }
      seenBarcodes.add(barcode);
    }

    if (lineBarcodes.length > 0) {
      normalized.push({ goodsId, targetQuantity, barcodes: lineBarcodes });
    }
  }

  return normalized;
}

function normalizeTargetQuantity(quantity: number | undefined) {
  if (quantity === undefined || quantity === null) return undefined;
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    throw new Error("目标数量必须为正整数");
  }
  return quantity;
}

function makeOrderNo(prefix: string) {
  const random = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `${prefix}${Date.now()}${random}`;
}

function toDbOutboundType(type: OutboundType): DbOutboundType {
  return type === "transfer" ? "TRANSFER" : "SALES";
}

async function warehouseLabel(
  tx: Prisma.TransactionClient,
  warehouseId: string | null,
  locationId: string | null
) {
  if (!warehouseId) return "未知仓库";
  const [warehouse, location] = await Promise.all([
    tx.warehouse.findUnique({ where: { id: warehouseId } }),
    locationId ? tx.storageLocation.findUnique({ where: { id: locationId } }) : null
  ]);
  if (!warehouse) return "未知仓库";
  return location ? `${warehouse.name} / ${location.name}` : warehouse.name;
}

function mapInboundSource(source: DbInboundSource) {
  return source === "FACTORY" ? "factory" : "terminal_return";
}

function mapOwnerType(type: DbInventoryItem["ownerType"]) {
  return type === "WAREHOUSE" ? "warehouse" : "salesperson";
}

function mapItemStatus(status: DbInventoryItem["status"]) {
  return status === "IN_STOCK" ? "in_stock" : "with_salesperson";
}

function mapMovementType(type: DbMovementType): MovementType {
  const movementTypes: Record<DbMovementType, MovementType> = {
    FACTORY_INBOUND: "factory_inbound",
    TERMINAL_RETURN_INBOUND: "terminal_return_inbound",
    TRANSFER: "transfer",
    SALES_OUTBOUND: "sales_outbound",
    SALES_RETURN: "sales_return"
  };

  return movementTypes[type];
}

function formatDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : undefined;
}

function formatDateTime(date: Date) {
  return formatAppDateTime(date);
}

function mapInventoryItem(item: DbInventoryItem): InventoryItem {
  return {
    id: item.id,
    barcode: item.barcode,
    goodsId: item.goodsId,
    ownerType: mapOwnerType(item.ownerType),
    warehouseId: item.warehouseId ?? undefined,
    locationId: item.locationId ?? undefined,
    salespersonId: item.salespersonId ?? undefined,
    status: mapItemStatus(item.status),
    productionDate: formatDate(item.productionDate),
    shelfLifeDate: formatDate(item.shelfLifeDate),
    inboundSource: mapInboundSource(item.inboundSource),
    lastMovedAt: formatDateTime(item.lastMovedAt)
  };
}

function mapStockMovement(movement: DbStockMovement): StockMovement {
  return {
    id: movement.id,
    itemId: movement.itemId,
    barcode: movement.barcode,
    goodsId: movement.goodsId,
    type: mapMovementType(movement.type),
    fromLabel: movement.fromLabel,
    toLabel: movement.toLabel,
    operator: movement.operatorName,
    occurredAt: formatDateTime(movement.occurredAt),
    note: movement.note
  };
}
