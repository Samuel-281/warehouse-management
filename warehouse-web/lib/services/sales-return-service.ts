import { assertBarcodeBatchLimit } from "@/lib/business-limits";
import { getPrisma } from "@/lib/db";
import { adjustWarehouseStock } from "@/lib/services/warehouse-stock-service";
import { formatAppDateTime } from "@/lib/warehouse-utils";
import type { InventoryItem, MovementType, StockMovement } from "@/lib/types";

type DbInboundSource = "FACTORY" | "TERMINAL_RETURN" | "OUTBOUND_SCAN";
type DbMovementType =
  | "FACTORY_INBOUND"
  | "TERMINAL_RETURN_INBOUND"
  | "TRANSFER"
  | "SALES_OUTBOUND"
  | "SALES_RETURN"
  | "ORDER_REVERSAL"
  | "BARCODE_CORRECTION"
  | "WRITE_OFF"
  | "MANUAL_ADJUSTMENT";

type DbInventoryItem = {
  id: string;
  barcode: string;
  goodsId: string;
  ownerType: "WAREHOUSE" | "SALESPERSON";
  warehouseId: string | null;
  locationId: string | null;
  salespersonId: string | null;
  status: "IN_STOCK" | "WITH_SALESPERSON" | "WRITTEN_OFF" | "VOIDED";
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
  assertBarcodeBatchLimit(barcodes);

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

    const invalid = items.find(
      (item) => item.status !== "WITH_SALESPERSON" || item.ownerType !== "SALESPERSON" || !item.salespersonId
    );
    if (invalid) throw new Error(`条码 ${invalid.barcode} 当前不在销售人员名下`);

    const time = new Date();
    const order = await tx.salesReturnOrder.create({
      data: {
        orderNo: makeOrderNo("XT"),
        returnWarehouseId: returnWarehouse.id,
        returnLocationId: returnLocation.id,
        operatorName: input.operatorName,
        createdAt: time,
        reversalSupported: true
      }
    });

    const toLabel = `${returnWarehouse.name} / ${returnLocation.name}`;
    const goodsQuantities = new Map<string, number>();
    for (const item of items) {
      goodsQuantities.set(item.goodsId, (goodsQuantities.get(item.goodsId) ?? 0) + 1);
    }

    for (const [goodsId, quantity] of goodsQuantities.entries()) {
      await adjustWarehouseStock(tx, {
        warehouseId: returnWarehouse.id,
        goodsId,
        quantityChange: quantity,
        type: "SALES_RETURN",
        orderKind: "sales_return",
        orderId: order.id,
        orderNo: order.orderNo,
        counterparty: "销售人员名下",
        operatorName: input.operatorName,
        occurredAt: time,
        note: "销售退回入库"
      });
    }

    const salespersonIds = [...new Set(items.map((item) => item.salespersonId).filter((id): id is string => Boolean(id)))];
    const salespersonNames = new Map(
      (
        await tx.salesperson.findMany({
          where: { id: { in: salespersonIds } },
          select: { id: true, name: true }
        })
      ).map((person) => [person.id, person.name])
    );

    const updated = await tx.inventoryItem.updateMany({
      where: {
        id: { in: items.map((item) => item.id) },
        ownerType: "SALESPERSON",
        status: "WITH_SALESPERSON"
      },
      data: {
        ownerType: "WAREHOUSE",
        warehouseId: returnWarehouse.id,
        locationId: returnLocation.id,
        salespersonId: null,
        status: "IN_STOCK",
        lastMovedAt: time
      }
    });
    if (updated.count !== items.length) throw new Error("部分条码已被其他设备处理，请刷新条码校验后重试");

    const persistedItems = await tx.inventoryItem.findMany({
      where: { id: { in: items.map((item) => item.id) } },
      orderBy: { barcode: "asc" }
    });
    const createdMovements = await tx.stockMovement.createManyAndReturn({
      data: persistedItems.map((item) => {
        const previous = itemByBarcode.get(item.barcode)!;
        return {
          itemId: item.id,
          barcode: item.barcode,
          goodsId: item.goodsId,
          type: "SALES_RETURN" as const,
          fromLabel: `销售人员：${salespersonNames.get(previous.salespersonId!) ?? "未知"}`,
          toLabel,
          operatorName: input.operatorName,
          occurredAt: time,
          note: "销售退回，仅将条码回流仓库",
          orderKind: "sales_return",
          orderId: order.id,
          orderNo: order.orderNo
        };
      })
    });
    await tx.salesReturnOrderItem.createMany({
      data: persistedItems.map((item) => {
        const previous = itemByBarcode.get(item.barcode)!;
        return {
          orderId: order.id,
          inventoryItemId: item.id,
          barcode: item.barcode,
          goodsId: item.goodsId,
          fromSalespersonId: previous.salespersonId!,
          beforeOwnerType: "SALESPERSON" as const,
          beforeWarehouseId: null,
          beforeLocationId: null,
          beforeSalespersonId: previous.salespersonId
        };
      })
    });

    return {
      orderId: order.id,
      items: persistedItems.map(mapInventoryItem),
      movements: createdMovements.map(mapStockMovement)
    };
  });
}

function makeOrderNo(prefix: string) {
  const random = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `${prefix}${Date.now()}${random}`;
}

function mapInboundSource(source: DbInboundSource) {
  if (source === "FACTORY") return "factory";
  if (source === "TERMINAL_RETURN") return "terminal_return";
  return "outbound_scan";
}

function mapOwnerType(type: DbInventoryItem["ownerType"]) {
  return type === "WAREHOUSE" ? "warehouse" : "salesperson";
}

function mapItemStatus(status: DbInventoryItem["status"]) {
  if (status === "IN_STOCK") return "in_stock";
  if (status === "WITH_SALESPERSON") return "with_salesperson";
  if (status === "WRITTEN_OFF") return "written_off";
  return "voided";
}

function mapMovementType(type: DbMovementType): MovementType {
  const movementTypes: Record<DbMovementType, MovementType> = {
    FACTORY_INBOUND: "factory_inbound",
    TERMINAL_RETURN_INBOUND: "terminal_return_inbound",
    TRANSFER: "transfer",
    SALES_OUTBOUND: "sales_outbound",
    SALES_RETURN: "sales_return",
    ORDER_REVERSAL: "order_reversal",
    BARCODE_CORRECTION: "barcode_correction",
    WRITE_OFF: "write_off",
    MANUAL_ADJUSTMENT: "manual_adjustment"
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
