import { getPrisma } from "@/lib/db";
import { assertBarcodeBatchLimit } from "@/lib/business-limits";
import { runIdempotentTransaction } from "@/lib/services/idempotency-service";
import { adjustWarehouseStock } from "@/lib/services/warehouse-stock-service";
import { formatAppDateTime } from "@/lib/warehouse-utils";
import type { InventoryItem, MovementType, OutboundType, StockMovement } from "@/lib/types";

type DbOutboundType = "TRANSFER" | "SALES";
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
  operatorUserId?: string;
  clientRequestId?: string;
};

export async function submitOutbound(input: SubmitOutboundInput) {
  const lines = normalizeOutboundLines(input);
  const barcodes = lines.flatMap((line) => line.barcodes);
  assertBarcodeBatchLimit(barcodes);

  if (barcodes.length === 0) {
    throw new Error("请先扫描或录入条码");
  }

  const prisma = getPrisma();
  return runIdempotentTransaction(
    prisma,
    {
      userId: input.operatorUserId,
      operationType: "OUTBOUND",
      clientRequestId: input.clientRequestId,
      payload: {
        sourceWarehouseId: input.sourceWarehouseId,
        targetWarehouseId: input.targetWarehouseId ?? null,
        targetLocationId: input.targetLocationId ?? null,
        salespersonId: input.salespersonId ?? null,
        lines
      }
    },
    async (tx) => {
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
      (item) => item.status !== "IN_STOCK" || item.ownerType !== "WAREHOUSE" || item.warehouseId !== sourceWarehouse.id
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
        createdAt: time,
        reversalSupported: true
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
        orderNo: order.orderNo,
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
          orderNo: order.orderNo,
          counterparty: sourceWarehouse.name,
          operatorName: input.operatorName,
          occurredAt: time,
          note: "扫码出库到达仓库"
        });
      }
    }

    const missingBarcodes = barcodes.filter((barcode) => !itemByBarcode.has(barcode));
    if (missingBarcodes.length > 0) {
      await tx.inventoryItem.createMany({
        data: missingBarcodes.map((barcode) => ({
          barcode,
          goodsId: lineByBarcode.get(barcode)!.goodsId,
          ownerType: destinationType === "transfer" ? "WAREHOUSE" : "SALESPERSON",
          warehouseId: destinationType === "transfer" ? targetWarehouse!.id : null,
          locationId: destinationType === "transfer" ? targetLocation!.id : null,
          salespersonId: destinationType === "sales" ? salesperson!.id : null,
          terminalStoreName: null,
          signedAt: null,
          status: destinationType === "transfer" ? "IN_STOCK" : "WITH_SALESPERSON",
          productionDate: null,
          shelfLifeDate: null,
          inboundSource: "OUTBOUND_SCAN",
          lastMovedAt: time
        }))
      });
    }

    if (items.length > 0) {
      const updated = await tx.inventoryItem.updateMany({
        where: {
          id: { in: items.map((item) => item.id) },
          ownerType: "WAREHOUSE",
          status: "IN_STOCK",
          warehouseId: sourceWarehouse.id
        },
        data:
          destinationType === "transfer"
            ? {
                ownerType: "WAREHOUSE",
                warehouseId: targetWarehouse!.id,
                locationId: targetLocation!.id,
                salespersonId: null,
                terminalStoreName: null,
                signedAt: null,
                status: "IN_STOCK",
                lastMovedAt: time
              }
            : {
                ownerType: "SALESPERSON",
                warehouseId: null,
                locationId: null,
                salespersonId: salesperson!.id,
                terminalStoreName: null,
                signedAt: null,
                status: "WITH_SALESPERSON",
                lastMovedAt: time
              }
      });
      if (updated.count !== items.length) throw new Error("部分条码已被其他设备处理，请刷新条码校验后重试");
    }

    const persistedItems = await tx.inventoryItem.findMany({
      where: { barcode: { in: barcodes } },
      orderBy: { barcode: "asc" }
    });
    if (persistedItems.length !== barcodes.length) throw new Error("条码写入不完整，请重试");

    const fromLabel = `${sourceWarehouse.name} / ${sourceLocation.name}`;
    const toLabel =
      destinationType === "transfer"
        ? `${targetWarehouse!.name} / ${targetLocation!.name}`
        : `销售人员：${salesperson!.name}`;
    const createdMovements = await tx.stockMovement.createManyAndReturn({
      data: persistedItems.map((item) => ({
        itemId: item.id,
        barcode: item.barcode,
        goodsId: item.goodsId,
        type: destinationType === "transfer" ? "TRANSFER" : "SALES_OUTBOUND",
        fromLabel,
        toLabel,
        operatorName: input.operatorName,
        occurredAt: time,
        note: destinationType === "transfer" ? "扫码出库发往仓库" : "扫码出库分配销售",
        orderKind: "outbound",
        orderId: order.id,
        orderNo: order.orderNo
      }))
    });

    await tx.outboundOrderItem.createMany({
      data: persistedItems.map((item) => {
        const previous = itemByBarcode.get(item.barcode);
        return {
          orderId: order.id,
          inventoryItemId: item.id,
          barcode: item.barcode,
          goodsId: item.goodsId,
          beforeOwnerType: "WAREHOUSE",
          beforeWarehouseId: sourceWarehouse.id,
          beforeLocationId: previous?.locationId ?? sourceLocation.id,
          beforeSalespersonId: null,
          createdTrackingItem: !previous
        };
      })
    });

    return {
      orderId: order.id,
      items: persistedItems.map(mapInventoryItem),
      movements: createdMovements.map(mapStockMovement)
    };
    }
  );
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

function mapInboundSource(source: DbInboundSource) {
  if (source === "FACTORY") return "factory";
  if (source === "TERMINAL_RETURN") return "terminal_return";
  return "outbound_scan";
}

function mapOwnerType(type: DbInventoryItem["ownerType"]) {
  if (type === "WAREHOUSE") return "warehouse";
  if (type === "SALESPERSON") return "salesperson";
  return "terminal_store";
}

function mapItemStatus(status: DbInventoryItem["status"]) {
  if (status === "IN_STOCK") return "in_stock";
  if (status === "WITH_SALESPERSON") return "with_salesperson";
  if (status === "SIGNED") return "signed";
  if (status === "RECEIPT_EXCEPTION") return "receipt_exception";
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
    terminalStoreName: item.terminalStoreName ?? undefined,
    signedAt: item.signedAt ? formatDateTime(item.signedAt) : undefined,
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
