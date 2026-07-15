import { getPrisma } from "@/lib/db";
import { assertBarcodeBatchLimit } from "@/lib/business-limits";
import { runIdempotentTransaction } from "@/lib/services/idempotency-service";
import { adjustWarehouseStock } from "@/lib/services/warehouse-stock-service";
import { submitSalesReturn } from "@/lib/services/sales-return-service";
import { addYears, formatAppDateTime } from "@/lib/warehouse-utils";
import type { InboundSource, InventoryItem, MovementType, StockMovement, TrackingSource } from "@/lib/types";

type DbInboundSource = "FACTORY" | "TERMINAL_RETURN" | "OUTBOUND_SCAN";
type DbMovementType = "FACTORY_INBOUND" | "TERMINAL_RETURN_INBOUND";

type DbInventoryItem = {
  id: string;
  barcode: string;
  goodsId: string;
  ownerType: "WAREHOUSE" | "SALESPERSON" | "TERMINAL_STORE";
  warehouseId: string | null;
  locationId: string | null;
  salespersonId: string | null;
  terminalStoreName: string | null;
  signedAt: Date | null;
  status: "IN_STOCK" | "WITH_SALESPERSON" | "SIGNED" | "RECEIPT_EXCEPTION" | "WRITTEN_OFF" | "VOIDED";
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
  operatorUserId?: string;
  clientRequestId?: string;
};

export async function submitInbound(input: SubmitInboundInput) {
  const rawBarcodes = Array.isArray(input.barcodes) ? input.barcodes : [];
  const barcodes = Array.from(new Set(rawBarcodes.map((barcode) => barcode.trim()).filter(Boolean)));
  assertBarcodeBatchLimit(barcodes);
  const quantity = normalizeQuantity(input.quantity ?? (input.source === "terminal_return" ? barcodes.length : 0));

  if (input.source === "terminal_return") {
    return submitSalesReturn({
      returnWarehouseId: input.warehouseId,
      returnLocationId: input.locationId,
      items: barcodes.map((barcode) => ({ barcode, goodsId: input.goodsId })),
      operatorName: input.operatorName,
      operatorUserId: input.operatorUserId,
      clientRequestId: input.clientRequestId
    });
  }

  if (input.source === "factory" && quantity <= 0) {
    throw new Error("厂家到货入库数量必须为正整数");
  }

  const prisma = getPrisma();
  return runIdempotentTransaction(
    prisma,
    {
      userId: input.operatorUserId,
      operationType: "INBOUND",
      clientRequestId: input.clientRequestId,
      payload: {
        source: input.source,
        warehouseId: input.warehouseId,
        locationId: input.locationId,
        goodsId: input.goodsId,
        terminalStoreId: input.terminalStoreId ?? null,
        productionDate: input.productionDate ?? null,
        quantity,
        barcodes
      }
    },
    async (tx) => {
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

    const existingItemByBarcode = new Map(existingItems.map((item) => [item.barcode, item]));
    const goodsMismatch = existingItems.find((item) => item.goodsId !== goods.id);
    if (goodsMismatch) throw new Error(`条码 ${goodsMismatch.barcode} 已绑定其他货物，不能按当前货物入库`);

    const existingWithDate = existingItems.filter((item) => item.productionDate);
    const existingWithoutDate = existingItems.filter((item) => !item.productionDate);
    for (const [group, includeProductionDate] of [
      [existingWithDate, false],
      [existingWithoutDate, true]
    ] as const) {
      if (group.length === 0) continue;
      const updated = await tx.inventoryItem.updateMany({
        where: {
          id: { in: group.map((item) => item.id) },
          ownerType: "SALESPERSON",
          status: "WITH_SALESPERSON"
        },
        data: {
          ownerType: "WAREHOUSE",
          warehouseId: warehouse.id,
          locationId: location.id,
          salespersonId: null,
          status: "IN_STOCK",
          ...(includeProductionDate ? { productionDate, shelfLifeDate } : {}),
          inboundSource: source,
          lastMovedAt: time
        }
      });
      if (updated.count !== group.length) throw new Error("部分条码已被其他设备处理，请刷新条码校验后重试");
    }

    const newBarcodes = barcodes.filter((barcode) => !existingItemByBarcode.has(barcode));
    if (newBarcodes.length > 0) {
      await tx.inventoryItem.createMany({
        data: newBarcodes.map((barcode) => ({
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
        }))
      });
    }

    const persistedItems = await tx.inventoryItem.findMany({
      where: { barcode: { in: barcodes } },
      orderBy: { barcode: "asc" }
    });
    if (persistedItems.length !== barcodes.length) throw new Error("条码写入不完整，请重试");

    const createdMovements = await tx.stockMovement.createManyAndReturn({
      data: persistedItems.map((item) => ({
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
      }))
    });

    await tx.inboundOrderItem.createMany({
      data: persistedItems.map((item) => {
        const previous = existingItemByBarcode.get(item.barcode);
        return {
          orderId: order.id,
          inventoryItemId: item.id,
          barcode: item.barcode,
          goodsId: goods.id,
          quantity: 1,
          productionDate,
          shelfLifeDate,
          beforeOwnerType: previous?.ownerType,
          beforeWarehouseId: previous?.warehouseId,
          beforeLocationId: previous?.locationId,
          beforeSalespersonId: previous?.salespersonId,
          createdTrackingItem: !previous
        };
      })
    });
    await adjustWarehouseStock(tx, {
      warehouseId: warehouse.id,
      goodsId: goods.id,
      quantityChange: persistedItems.length,
      type: "TERMINAL_RETURN_INBOUND",
      orderKind: "inbound",
      orderId: order.id,
      orderNo: order.orderNo,
      counterparty: fromLabel,
      operatorName: input.operatorName,
      occurredAt: time,
      note: `终端店铺退换货入库，生产日期 ${input.productionDate}`
    });

    return {
      orderId: order.id,
      quantity: persistedItems.length,
      items: persistedItems.map(mapInventoryItem),
      movements: createdMovements.map(mapStockMovement)
    };
    }
  );
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

function mapInboundSource(source: DbInboundSource): TrackingSource {
  if (source === "FACTORY") return "factory";
  if (source === "TERMINAL_RETURN") return "terminal_return";
  return "outbound_scan";
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
