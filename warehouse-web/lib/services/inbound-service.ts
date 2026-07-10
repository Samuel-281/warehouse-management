import { getPrisma } from "@/lib/db";
import { assertBarcodeBatchLimit } from "@/lib/business-limits";
import { adjustWarehouseStock } from "@/lib/services/warehouse-stock-service";
import { addYears, formatAppDateTime } from "@/lib/warehouse-utils";
import type { InboundSource, InventoryItem, MovementType, StockMovement } from "@/lib/types";

type DbInboundSource = "FACTORY" | "TERMINAL_RETURN";
type DbMovementType = "FACTORY_INBOUND" | "TERMINAL_RETURN_INBOUND";

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
  type:
    | DbMovementType
    | "TRANSFER"
    | "SALES_OUTBOUND"
    | "SALES_RETURN"
    | "ORDER_REVERSAL"
    | "BARCODE_CORRECTION"
    | "WRITE_OFF"
    | "MANUAL_ADJUSTMENT";
  fromLabel: string;
  toLabel: string;
  operatorName: string;
  occurredAt: Date;
  note: string;
};

export type SubmitInboundInput = {
  source: InboundSource;
  warehouseId: string;
  locationId: string;
  goodsId: string;
  terminalStoreId?: string;
  productionDate?: string;
  quantity?: number;
  barcodes?: string[];
  operatorName: string;
};

export async function submitInbound(input: SubmitInboundInput) {
  const rawBarcodes = Array.isArray(input.barcodes) ? input.barcodes : [];
  const barcodes = Array.from(new Set(rawBarcodes.map((barcode) => barcode.trim()).filter(Boolean)));
  assertBarcodeBatchLimit(barcodes);
  const quantity = normalizeQuantity(input.quantity ?? (input.source === "terminal_return" ? barcodes.length : 0));

  if (input.source === "factory" && quantity <= 0) {
    throw new Error("厂家到货入库数量必须为正整数");
  }
  if (input.source === "terminal_return" && barcodes.length === 0) {
    throw new Error("请先扫描或录入退换货条码");
  }
  if (input.source === "terminal_return" && !input.productionDate) {
    throw new Error("终端店铺退换货入库必须登记生产日期");
  }

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const [goods, warehouse, location] = await Promise.all([
      tx.goods.findUnique({ where: { id: input.goodsId } }),
      tx.warehouse.findUnique({ where: { id: input.warehouseId } }),
      tx.storageLocation.findUnique({ where: { id: input.locationId } })
    ]);

    if (!goods) throw new Error("请选择有效的货物");
    if (!warehouse) throw new Error("请选择有效的入库仓库");
    if (!location || location.warehouseId !== warehouse.id) {
      throw new Error("请选择有效的入库库位");
    }

    const time = new Date();
    const source = toDbInboundSource(input.source);
    const movementType = toDbMovementType(input.source);
    const toLabel = `${warehouse.name} / ${location.name}`;
    const order = await tx.inboundOrder.create({
      data: {
        orderNo: makeOrderNo("RK"),
        source,
        warehouseId: warehouse.id,
        locationId: location.id,
        terminalStoreId: input.source === "terminal_return" ? input.terminalStoreId : undefined,
        operatorName: input.operatorName,
        createdAt: time,
        reversalSupported: true
      }
    });

    if (input.source === "factory") {
      await tx.inboundOrderItem.create({
        data: {
          orderId: order.id,
          goodsId: goods.id,
          quantity
        }
      });
      await adjustWarehouseStock(tx, {
        warehouseId: warehouse.id,
        goodsId: goods.id,
        quantityChange: quantity,
        type: "FACTORY_INBOUND",
        orderKind: "inbound",
        orderId: order.id,
        orderNo: order.orderNo,
        counterparty: "厂家到货",
        operatorName: input.operatorName,
        occurredAt: time,
        note: "厂家到货数量入库"
      });

      return { orderId: order.id, quantity, items: [], movements: [] };
    }

    const existingItems = await tx.inventoryItem.findMany({
      where: { barcode: { in: barcodes } },
      orderBy: { barcode: "asc" }
    });

    const invalid = existingItems.find(
      (item) => item.status !== "WITH_SALESPERSON" || item.ownerType !== "SALESPERSON" || !item.salespersonId
    );
    if (invalid) {
      throw new Error(`条码 ${invalid.barcode} 已在仓库或异常状态中，不能作为终端店铺退换货重复入库`);
    }

    const terminalStore =
      input.terminalStoreId ? await tx.terminalStore.findUnique({ where: { id: input.terminalStoreId } }) : null;
    const productionDate = input.productionDate ? new Date(input.productionDate) : null;
    const shelfLifeDate = goods.category === "HEALTH_WINE" && input.productionDate ? new Date(addYears(input.productionDate, 3)) : null;
    const fromLabel = terminalStore?.name ?? "终端店铺";

    const items: InventoryItem[] = [];
    const movements: StockMovement[] = [];
    const existingItemByBarcode = new Map(existingItems.map((item) => [item.barcode, item]));

    for (const barcode of barcodes) {
      const existingItem = existingItemByBarcode.get(barcode);
      if (existingItem && existingItem.goodsId !== goods.id) {
        throw new Error(`条码 ${barcode} 已绑定其他货物，不能按当前货物入库`);
      }

      const nextProductionDate = existingItem?.productionDate ?? productionDate;
      const nextShelfLifeDate = existingItem?.productionDate ? existingItem.shelfLifeDate : shelfLifeDate;
      const item = existingItem
        ? await tx.inventoryItem.update({
            where: { id: existingItem.id },
            data: {
              ownerType: "WAREHOUSE",
              warehouseId: warehouse.id,
              locationId: location.id,
              salespersonId: null,
              status: "IN_STOCK",
              productionDate: nextProductionDate,
              shelfLifeDate: nextShelfLifeDate,
              inboundSource: source,
              lastMovedAt: time
            }
          })
        : await tx.inventoryItem.create({
            data: {
              barcode,
              goodsId: goods.id,
              ownerType: "WAREHOUSE",
              warehouseId: warehouse.id,
              locationId: location.id,
              status: "IN_STOCK",
              productionDate,
              shelfLifeDate,
              inboundSource: source,
              lastMovedAt: time
            }
          });
      const movement = await tx.stockMovement.create({
        data: {
          itemId: item.id,
          barcode: item.barcode,
          goodsId: goods.id,
          type: movementType,
          fromLabel,
          toLabel,
          operatorName: input.operatorName,
          occurredAt: time,
          note: `终端店铺退换货入库，生产日期 ${input.productionDate}`,
          orderKind: "inbound",
          orderId: order.id,
          orderNo: order.orderNo
        }
      });

      await tx.inboundOrderItem.create({
        data: {
          orderId: order.id,
          inventoryItemId: item.id,
          barcode: item.barcode,
          goodsId: goods.id,
          quantity: 1,
          productionDate,
          shelfLifeDate,
          beforeOwnerType: existingItem?.ownerType,
          beforeWarehouseId: existingItem?.warehouseId,
          beforeLocationId: existingItem?.locationId,
          beforeSalespersonId: existingItem?.salespersonId,
          createdTrackingItem: !existingItem
        }
      });
      await adjustWarehouseStock(tx, {
        warehouseId: warehouse.id,
        goodsId: goods.id,
        quantityChange: 1,
        type: "TERMINAL_RETURN_INBOUND",
        orderKind: "inbound",
        orderId: order.id,
        orderNo: order.orderNo,
        barcode: item.barcode,
        counterparty: fromLabel,
        operatorName: input.operatorName,
        occurredAt: time,
        note: `终端店铺退换货入库，生产日期 ${input.productionDate}`
      });

      items.push(mapInventoryItem(item));
      movements.push(mapStockMovement(movement));
    }

    return { orderId: order.id, quantity: items.length, items, movements };
  });
}

function normalizeQuantity(quantity: number) {
  return Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
}

function makeOrderNo(prefix: string) {
  const random = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `${prefix}${Date.now()}${random}`;
}

function toDbInboundSource(source: InboundSource): DbInboundSource {
  return source === "factory" ? "FACTORY" : "TERMINAL_RETURN";
}

function toDbMovementType(source: InboundSource): DbMovementType {
  return source === "factory" ? "FACTORY_INBOUND" : "TERMINAL_RETURN_INBOUND";
}

function mapInboundSource(source: DbInboundSource): InboundSource {
  return source === "FACTORY" ? "factory" : "terminal_return";
}

function mapMovementType(type: DbStockMovement["type"]): MovementType {
  const movementTypes: Record<DbStockMovement["type"], MovementType> = {
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
    ownerType: "warehouse",
    warehouseId: item.warehouseId ?? undefined,
    locationId: item.locationId ?? undefined,
    salespersonId: item.salespersonId ?? undefined,
    status: "in_stock",
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
