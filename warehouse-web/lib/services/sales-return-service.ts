import type { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/db";
import { formatAppDateTime } from "@/lib/warehouse-utils";
import type { InventoryItem, MovementType, StockMovement } from "@/lib/types";

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

export type SubmitSalesReturnInput = {
  returnWarehouseId: string;
  returnLocationId: string;
  barcodes: string[];
  operatorName: string;
};

export async function submitSalesReturn(input: SubmitSalesReturnInput) {
  const barcodes = Array.from(new Set(input.barcodes.map((barcode) => barcode.trim()).filter(Boolean)));

  if (barcodes.length === 0) {
    throw new Error("请先扫描或录入销售人员名下条码");
  }

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const [returnWarehouse, returnLocation] = await Promise.all([
      tx.warehouse.findUnique({ where: { id: input.returnWarehouseId } }),
      tx.storageLocation.findUnique({ where: { id: input.returnLocationId } })
    ]);

    if (!returnWarehouse) throw new Error("请选择有效的回流仓库");
    if (!returnLocation || returnLocation.warehouseId !== returnWarehouse.id) throw new Error("请选择有效的回流库位");

    const items = await tx.inventoryItem.findMany({
      where: { barcode: { in: barcodes } },
      orderBy: { barcode: "asc" }
    });
    const itemByBarcode = new Map(items.map((item) => [item.barcode, item]));
    const missing = barcodes.find((barcode) => !itemByBarcode.has(barcode));
    if (missing) throw new Error(`条码 ${missing} 不存在`);

    const invalid = items.find((item) => item.ownerType !== "SALESPERSON" || !item.salespersonId);
    if (invalid) throw new Error(`条码 ${invalid.barcode} 当前不在销售人员名下`);

    const time = new Date();
    const order = await tx.salesReturnOrder.create({
      data: {
        orderNo: makeOrderNo("XT"),
        returnWarehouseId: returnWarehouse.id,
        returnLocationId: returnLocation.id,
        operatorName: input.operatorName,
        createdAt: time
      }
    });

    const updatedItems: InventoryItem[] = [];
    const movements: StockMovement[] = [];
    const toLabel = `${returnWarehouse.name} / ${returnLocation.name}`;

    for (const barcode of barcodes) {
      const item = itemByBarcode.get(barcode);
      if (!item || !item.salespersonId) continue;

      const fromLabel = await salespersonLabel(tx, item.salespersonId);
      const previousSalespersonId = item.salespersonId;
      const updated = await tx.inventoryItem.update({
        where: { id: item.id },
        data: {
          ownerType: "WAREHOUSE",
          warehouseId: returnWarehouse.id,
          locationId: returnLocation.id,
          salespersonId: null,
          status: "IN_STOCK",
          lastMovedAt: time
        }
      });

      const movement = await tx.stockMovement.create({
        data: {
          itemId: updated.id,
          barcode: updated.barcode,
          goodsId: updated.goodsId,
          type: "SALES_RETURN",
          fromLabel,
          toLabel,
          operatorName: input.operatorName,
          occurredAt: time,
          note: "销售退回，仅将条码回流仓库"
        }
      });

      await tx.salesReturnOrderItem.create({
        data: {
          orderId: order.id,
          inventoryItemId: updated.id,
          barcode: updated.barcode,
          goodsId: updated.goodsId,
          fromSalespersonId: previousSalespersonId
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

async function salespersonLabel(tx: Prisma.TransactionClient, salespersonId: string) {
  const salesperson = await tx.salesperson.findUnique({ where: { id: salespersonId } });
  return `销售人员：${salesperson?.name ?? "未知"}`;
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
