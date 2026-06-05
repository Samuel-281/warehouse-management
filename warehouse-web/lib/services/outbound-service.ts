import type { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/db";
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

export type SubmitOutboundInput = {
  type: OutboundType;
  sourceWarehouseId: string;
  targetWarehouseId?: string;
  targetLocationId?: string;
  salespersonId?: string;
  goodsId?: string;
  barcodes: string[];
  operatorName: string;
};

export async function submitOutbound(input: SubmitOutboundInput) {
  const barcodes = Array.from(new Set(input.barcodes.map((barcode) => barcode.trim()).filter(Boolean)));

  if (barcodes.length === 0) {
    throw new Error("请先扫描或录入条码");
  }

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const sourceWarehouse = await tx.warehouse.findUnique({ where: { id: input.sourceWarehouseId } });
    if (!sourceWarehouse) throw new Error("请选择有效的出库仓库");
    const time = new Date();

    if (input.type === "direct") {
      if (!input.goodsId) throw new Error("直接出库必须选择货物");
      const goods = await tx.goods.findUnique({ where: { id: input.goodsId } });
      if (!goods) throw new Error("请选择有效的货物");

      const sourceLocation = await tx.storageLocation.findFirst({
        where: { warehouseId: sourceWarehouse.id, status: "ENABLED" },
        orderBy: { createdAt: "asc" }
      });
      if (!sourceLocation) throw new Error("出库仓库缺少可用默认库位");

      const existingItems = await tx.inventoryItem.findMany({
        where: { barcode: { in: barcodes } },
        orderBy: { barcode: "asc" }
      });
      if (existingItems.length > 0) {
        throw new Error(`条码 ${existingItems[0].barcode} 已存在，直接出库只能录入新条码`);
      }

      const targetWarehouse = input.targetWarehouseId
        ? await tx.warehouse.findUnique({ where: { id: input.targetWarehouseId } })
        : null;
      const targetLocation = input.targetLocationId
        ? await tx.storageLocation.findUnique({ where: { id: input.targetLocationId } })
        : null;
      const salesperson = input.salespersonId
        ? await tx.salesperson.findUnique({ where: { id: input.salespersonId } })
        : null;

      const directDestinationType = input.targetWarehouseId ? "transfer" : "sales";
      if (directDestinationType === "transfer") {
        if (!targetWarehouse) throw new Error("直接出库发往仓库时必须选择目标仓库");
        if (targetWarehouse.id === sourceWarehouse.id) throw new Error("目标仓库不能与出库仓库相同");
        if (!targetLocation || targetLocation.warehouseId !== targetWarehouse.id) throw new Error("请选择有效的目标库位");
      }
      if (directDestinationType === "sales" && !salesperson) {
        throw new Error("直接出库分配销售时必须选择销售人员");
      }

      const inboundOrder = await tx.inboundOrder.create({
        data: {
          orderNo: makeOrderNo("RK"),
          source: "FACTORY",
          warehouseId: sourceWarehouse.id,
          locationId: sourceLocation.id,
          operatorName: input.operatorName,
          createdAt: time
        }
      });
      const outboundOrder = await tx.outboundOrder.create({
        data: {
          orderNo: makeOrderNo("CK"),
          type: directDestinationType === "transfer" ? "TRANSFER" : "SALES",
          sourceWarehouseId: sourceWarehouse.id,
          targetWarehouseId: directDestinationType === "transfer" ? targetWarehouse?.id : undefined,
          targetLocationId: directDestinationType === "transfer" ? targetLocation?.id : undefined,
          salespersonId: directDestinationType === "sales" ? salesperson?.id : undefined,
          operatorName: input.operatorName,
          createdAt: time
        }
      });

      const updatedItems: InventoryItem[] = [];
      const movements: StockMovement[] = [];

      for (const barcode of barcodes) {
        const created = await tx.inventoryItem.create({
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
        });

        const inboundMovement = await tx.stockMovement.create({
          data: {
            itemId: created.id,
            barcode: created.barcode,
            goodsId: goods.id,
            type: "FACTORY_INBOUND",
            fromLabel: "无库存",
            toLabel: `${sourceWarehouse.name} / ${sourceLocation.name}`,
            operatorName: input.operatorName,
            occurredAt: time,
            note: "直接出库前自动登记入库"
          }
        });

        await tx.inboundOrderItem.create({
          data: {
            orderId: inboundOrder.id,
            inventoryItemId: created.id,
            barcode: created.barcode,
            goodsId: goods.id
          }
        });

        const toLabel =
          directDestinationType === "transfer"
            ? `${targetWarehouse?.name ?? "目标仓库"} / ${targetLocation?.name ?? "默认库位"}`
            : `销售人员：${salesperson?.name ?? "未知"}`;
        const updated = await tx.inventoryItem.update({
          where: { id: created.id },
          data:
            directDestinationType === "transfer"
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
        const outboundMovement = await tx.stockMovement.create({
          data: {
            itemId: updated.id,
            barcode: updated.barcode,
            goodsId: goods.id,
            type: directDestinationType === "transfer" ? "TRANSFER" : "SALES_OUTBOUND",
            fromLabel: `${sourceWarehouse.name} / ${sourceLocation.name}`,
            toLabel,
            operatorName: input.operatorName,
            occurredAt: time,
            note: directDestinationType === "transfer" ? "直接出库：登记后立即发往仓库" : "直接出库：登记后立即分配销售"
          }
        });

        await tx.outboundOrderItem.create({
          data: {
            orderId: outboundOrder.id,
            inventoryItemId: updated.id,
            barcode: updated.barcode,
            goodsId: goods.id
          }
        });

        updatedItems.push(mapInventoryItem(updated));
        movements.push(mapStockMovement(outboundMovement), mapStockMovement(inboundMovement));
      }

      return { orderId: outboundOrder.id, inboundOrderId: inboundOrder.id, items: updatedItems, movements };
    }

    const targetWarehouse =
      input.type === "transfer" && input.targetWarehouseId
        ? await tx.warehouse.findUnique({ where: { id: input.targetWarehouseId } })
        : null;
    const targetLocation =
      input.type === "transfer" && input.targetLocationId
        ? await tx.storageLocation.findUnique({ where: { id: input.targetLocationId } })
        : null;
    const salesperson =
      input.type === "sales" && input.salespersonId
        ? await tx.salesperson.findUnique({ where: { id: input.salespersonId } })
        : null;

    if (input.type === "transfer") {
      if (!targetWarehouse) throw new Error("挪仓必须选择目标仓库");
      if (targetWarehouse.id === sourceWarehouse.id) throw new Error("目标仓库不能与出库仓库相同");
      if (!targetLocation || targetLocation.warehouseId !== targetWarehouse.id) throw new Error("请选择有效的目标库位");
    }

    if (input.type === "sales" && !salesperson) {
      throw new Error("销售出库必须选择销售人员");
    }

    const items = await tx.inventoryItem.findMany({
      where: { barcode: { in: barcodes } },
      orderBy: { barcode: "asc" }
    });
    const itemByBarcode = new Map(items.map((item) => [item.barcode, item]));
    const missing = barcodes.find((barcode) => !itemByBarcode.has(barcode));
    if (missing) throw new Error(`条码 ${missing} 不存在`);

    const invalid = items.find((item) => item.ownerType !== "WAREHOUSE" || item.warehouseId !== sourceWarehouse.id);
    if (invalid) throw new Error(`条码 ${invalid.barcode} 不在所选仓库库存中`);

    const order = await tx.outboundOrder.create({
      data: {
        orderNo: makeOrderNo("CK"),
        type: toDbOutboundType(input.type),
        sourceWarehouseId: sourceWarehouse.id,
        targetWarehouseId: input.type === "transfer" ? targetWarehouse?.id : undefined,
        targetLocationId: input.type === "transfer" ? targetLocation?.id : undefined,
        salespersonId: input.type === "sales" ? salesperson?.id : undefined,
        operatorName: input.operatorName,
        createdAt: time
      }
    });

    const updatedItems: InventoryItem[] = [];
    const movements: StockMovement[] = [];

    for (const barcode of barcodes) {
      const item = itemByBarcode.get(barcode);
      if (!item) continue;

      const fromLabel = await warehouseLabel(tx, item.warehouseId, item.locationId);
      const toLabel =
        input.type === "transfer"
          ? `${targetWarehouse?.name ?? "目标仓库"} / ${targetLocation?.name ?? "默认库位"}`
          : `销售人员：${salesperson?.name ?? "未知"}`;

      const updated = await tx.inventoryItem.update({
        where: { id: item.id },
        data:
          input.type === "transfer"
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
          type: input.type === "transfer" ? "TRANSFER" : "SALES_OUTBOUND",
          fromLabel,
          toLabel,
          operatorName: input.operatorName,
          occurredAt: time,
          note: input.type === "transfer" ? "仓库之间挪仓" : "销售出库"
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

    return { orderId: order.id, items: updatedItems, movements };
  });
}

function makeOrderNo(prefix: string) {
  const random = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `${prefix}${Date.now()}${random}`;
}

function toDbOutboundType(type: OutboundType): DbOutboundType {
  if (type === "direct") throw new Error("直接出库流程尚未接入后端");
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
