import { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/db";
import { assertBarcodeBatchLimit } from "@/lib/business-limits";
import { formatAppDateTime } from "@/lib/warehouse-utils";
import type {
  InventoryDetailResult,
  InventoryItem,
  InventoryListResult,
  InventoryStatusScope,
  InventorySummary,
  MovementType,
  OwnerType,
  StockMovement,
  TrackingSource,
  WarehouseStock,
  WarehouseStockMovement
} from "@/lib/types";

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

type DbWarehouseStock = {
  id: string;
  warehouseId: string;
  goodsId: string;
  quantity: number;
  lastChangedAt: Date;
};

type DbWarehouseStockMovement = {
  id: string;
  warehouseId: string;
  goodsId: string;
  type: DbMovementType;
  quantityChange: number;
  balanceAfter: number;
  orderKind: string | null;
  orderId: string | null;
  barcode: string | null;
  counterparty: string | null;
  operatorName: string;
  occurredAt: Date;
  note: string;
};

export type InventoryQueryInput = {
  keyword?: string;
  statusScope?: InventoryStatusScope;
  ownerScope?: "all" | "warehouse" | "salesperson";
  warehouseId?: string;
  salespersonId?: string;
  goodsId?: string;
  page?: number;
  pageSize?: number;
};

export type BarcodeValidationMode = "factory_inbound" | "terminal_return_inbound" | "warehouse_outbound" | "sales_return";

export type BarcodeValidationInput = {
  mode: BarcodeValidationMode;
  barcodes: string[];
  goodsId?: string;
  warehouseId?: string;
};

export type BarcodeValidationResult = {
  barcode: string;
  ok: boolean;
  label: string;
  detail: string;
  item?: InventoryItem;
};

export async function listInventory(input: InventoryQueryInput): Promise<InventoryListResult> {
  const prisma = getPrisma();
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const exactItemId = await resolveExactBarcode(input.keyword);
  const where = buildInventoryWhere(input, exactItemId);

  const [total, warehouseResultCount, salesResultCount, items] = await Promise.all([
    prisma.inventoryItem.count({ where }),
    prisma.inventoryItem.count({ where: { ...where, ownerType: "WAREHOUSE" } }),
    prisma.inventoryItem.count({ where: { ...where, ownerType: "SALESPERSON" } }),
    prisma.inventoryItem.findMany({
      where,
      orderBy: [{ lastMovedAt: "desc" }, { barcode: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);

  const latestMovements = await latestMovementForItems(items.map((item) => item.id));

  return {
    items: items.map(mapInventoryItem),
    latestMovements,
    total,
    warehouseResultCount,
    salesResultCount,
    page,
    pageSize
  };
}

export async function getInventoryDetail(barcode: string): Promise<InventoryDetailResult> {
  const prisma = getPrisma();
  const normalizedBarcode = barcode.trim();
  const directItem = await prisma.inventoryItem.findUnique({ where: { barcode: normalizedBarcode } });
  const correction = directItem
    ? null
    : await prisma.barcodeCorrection.findUnique({
        where: { oldBarcode: normalizedBarcode },
        include: { item: true }
      });
  const item = directItem ?? correction?.item;
  if (!item) {
    throw new Error(`条码 ${barcode} 不存在`);
  }

  const [movements, corrections] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { itemId: item.id },
      orderBy: { occurredAt: "desc" }
    }),
    prisma.barcodeCorrection.findMany({
      where: { itemId: item.id },
      orderBy: { occurredAt: "desc" }
    })
  ]);

  return {
    item: mapInventoryItem(item),
    movements: movements.map(mapStockMovement),
    corrections: corrections.map((entry) => ({
      id: entry.id,
      oldBarcode: entry.oldBarcode,
      newBarcode: entry.newBarcode,
      reason: entry.reason,
      operator: entry.operatorName,
      occurredAt: formatAppDateTime(entry.occurredAt)
    }))
  };
}

export async function deleteInventoryItemByBarcode(barcode: string) {
  const normalizedBarcode = barcode.trim();
  if (!normalizedBarcode) throw new Error("请选择需要删除的条码");

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.findUnique({ where: { barcode: normalizedBarcode } });
    if (!item) throw new Error(`条码 ${normalizedBarcode} 不存在`);

    const [movementCount, correctionCount, inboundCount, outboundCount, salesReturnCount] = await Promise.all([
      tx.stockMovement.count({ where: { itemId: item.id } }),
      tx.barcodeCorrection.count({ where: { itemId: item.id } }),
      tx.inboundOrderItem.count({ where: { inventoryItemId: item.id } }),
      tx.outboundOrderItem.count({ where: { inventoryItemId: item.id } }),
      tx.salesReturnOrderItem.count({ where: { inventoryItemId: item.id } })
    ]);
    if (movementCount + correctionCount + inboundCount + outboundCount + salesReturnCount > 0) {
      throw new Error("该条码已有单据、流转或更正历史，不能彻底删除；请使用单据撤销或货物核销");
    }

    await tx.inventoryItem.delete({ where: { id: item.id } });

    return { deleted: true };
  });
}

export async function getInventorySummary(): Promise<InventorySummary> {
  const prisma = getPrisma();
  const [
    totalItems,
    inStock,
    withSales,
    writtenOff,
    warehouseStocks,
    warehouseStockAggregate,
    warehouseGroups,
    salespersonGroups,
    recentMovements,
    recentStockMovements
  ] =
    await Promise.all([
      prisma.inventoryItem.count({ where: { status: { in: ["IN_STOCK", "WITH_SALESPERSON"] } } }),
      prisma.inventoryItem.count({ where: { ownerType: "WAREHOUSE", status: "IN_STOCK" } }),
      prisma.inventoryItem.count({ where: { ownerType: "SALESPERSON", status: "WITH_SALESPERSON" } }),
      prisma.inventoryItem.count({ where: { status: "WRITTEN_OFF" } }),
      prisma.warehouseStock.findMany({ orderBy: [{ warehouseId: "asc" }, { goodsId: "asc" }] }),
      prisma.warehouseStock.aggregate({ _sum: { quantity: true } }),
      prisma.inventoryItem.groupBy({
        by: ["warehouseId"],
        where: { ownerType: "WAREHOUSE", status: "IN_STOCK", warehouseId: { not: null } },
        _count: { _all: true }
      }),
      prisma.inventoryItem.groupBy({
        by: ["salespersonId"],
        where: { ownerType: "SALESPERSON", status: "WITH_SALESPERSON", salespersonId: { not: null } },
        _count: { _all: true }
      }),
      prisma.stockMovement.findMany({
        orderBy: { occurredAt: "desc" },
        take: 8
      }),
      prisma.warehouseStockMovement.findMany({
        orderBy: { occurredAt: "desc" },
        take: 12
      })
    ]);
  const warehouseCounts = warehouseGroups
    .filter((group) => group.warehouseId)
    .map((group) => ({ warehouseId: group.warehouseId as string, count: group._count._all }));

  return {
    totalItems,
    inStock,
    withSales,
    writtenOff,
    totalWarehouseQuantity: warehouseStockAggregate._sum.quantity ?? 0,
    warehouseStocks: warehouseStocks.map(mapWarehouseStock),
    recentStockMovements: recentStockMovements.map(mapWarehouseStockMovement),
    warehouseCounts,
    salespersonCounts: salespersonGroups
      .filter((group) => group.salespersonId)
      .map((group) => ({ salespersonId: group.salespersonId as string, count: group._count._all })),
    recentMovements: recentMovements.map(mapStockMovement)
  };
}

export async function validateBarcodes(input: BarcodeValidationInput): Promise<BarcodeValidationResult[]> {
  const barcodes = Array.from(new Set(input.barcodes.map((barcode) => barcode.trim()).filter(Boolean)));
  if (barcodes.length === 0) return [];
  assertBarcodeBatchLimit(barcodes);

  const prisma = getPrisma();
  const items = await prisma.inventoryItem.findMany({ where: { barcode: { in: barcodes } } });
  const itemByBarcode = new Map(items.map((item) => [item.barcode, item]));

  return barcodes.map((barcode) => {
    const item = itemByBarcode.get(barcode);
    if (item?.status === "WRITTEN_OFF" || item?.status === "VOIDED") {
      return {
        barcode,
        ok: false,
        label: item.status === "WRITTEN_OFF" ? "已核销" : "已撤销",
        detail: "该条码已经结束追踪，不能参与新的仓库业务",
        item: mapInventoryItem(item)
      };
    }
    if (input.mode === "factory_inbound") {
      if (item) {
        return { barcode, ok: false, label: "已存在", detail: "厂家到货条码不可重复", item: mapInventoryItem(item) };
      }
      return { barcode, ok: true, label: "新条码", detail: "可作为厂家到货入库" };
    }

    if (input.mode === "terminal_return_inbound") {
      if (!item) return { barcode, ok: true, label: "新退换货", detail: "可登记为终端退换货入库" };
      if (input.goodsId && item.goodsId !== input.goodsId) {
        return { barcode, ok: false, label: "货物不符", detail: "该条码已绑定其他货物", item: mapInventoryItem(item) };
      }
      if (item.ownerType !== "SALESPERSON" || !item.salespersonId) {
        return { barcode, ok: false, label: "不可入库", detail: "该条码当前不在销售人员名下", item: mapInventoryItem(item) };
      }
      return { barcode, ok: true, label: "可回仓", detail: "该条码当前在销售人员名下", item: mapInventoryItem(item) };
    }

    if (input.mode === "warehouse_outbound") {
      if (!item) {
        return { barcode, ok: true, label: "新出库条码", detail: "系统将从所选仓库库存中扣减并建立条码追踪" };
      }
      if (input.goodsId && item.goodsId !== input.goodsId) {
        return { barcode, ok: false, label: "货物不符", detail: "该条码已绑定其他货物", item: mapInventoryItem(item) };
      }
      if (item.ownerType !== "WAREHOUSE" || item.warehouseId !== input.warehouseId) {
        return { barcode, ok: false, label: "仓库不符", detail: "条码当前不在所选仓库库存中", item: mapInventoryItem(item) };
      }
      return { barcode, ok: true, label: "可出库", detail: "条码当前在所选仓库库存中", item: mapInventoryItem(item) };
    }

    if (!item) return { barcode, ok: false, label: "不存在", detail: "系统内未找到该条码" };

    if (item.ownerType !== "SALESPERSON" || !item.salespersonId) {
      return { barcode, ok: false, label: "不可退回", detail: "条码当前不在销售人员名下", item: mapInventoryItem(item) };
    }
    return { barcode, ok: true, label: "可退回", detail: "条码当前在销售人员名下", item: mapInventoryItem(item) };
  });
}

function buildInventoryWhere(input: InventoryQueryInput, exactItemId?: string): Prisma.InventoryItemWhereInput {
  if (exactItemId) return { id: exactItemId };

  const where: Prisma.InventoryItemWhereInput = {};
  const keyword = input.keyword?.trim();
  const statusScope = normalizeStatusScope(input.statusScope);

  if (statusScope === "active") where.status = { in: ["IN_STOCK", "WITH_SALESPERSON"] };
  if (statusScope === "written_off") where.status = "WRITTEN_OFF";
  if (statusScope === "voided") where.status = "VOIDED";

  if (input.ownerScope === "warehouse") {
    where.ownerType = "WAREHOUSE";
    if (input.warehouseId && input.warehouseId !== "all") where.warehouseId = input.warehouseId;
  } else if (input.ownerScope === "salesperson") {
    where.ownerType = "SALESPERSON";
    if (input.salespersonId && input.salespersonId !== "all") where.salespersonId = input.salespersonId;
  }

  if (input.goodsId && input.goodsId !== "all") {
    where.goodsId = input.goodsId;
  }

  if (keyword) {
    where.OR = [
      { barcode: { contains: keyword, mode: "insensitive" } },
      { goods: { name: { contains: keyword, mode: "insensitive" } } },
      { goods: { code: { contains: keyword, mode: "insensitive" } } }
    ];
  }

  return where;
}

function normalizeStatusScope(value?: InventoryStatusScope): InventoryStatusScope {
  return value === "all" || value === "written_off" || value === "voided" ? value : "active";
}

async function latestMovementForItems(itemIds: string[]) {
  if (itemIds.length === 0) return [];
  const prisma = getPrisma();
  const movements = await prisma.$queryRaw<DbStockMovement[]>(Prisma.sql`
    SELECT DISTINCT ON ("itemId")
      id, "itemId", barcode, "goodsId", type, "fromLabel", "toLabel", "operatorName", "occurredAt", note
    FROM "stock_movements"
    WHERE "itemId" IN (${Prisma.join(itemIds)})
    ORDER BY "itemId", "occurredAt" DESC
  `);
  return movements.map(mapStockMovement);
}

async function resolveExactBarcode(keyword?: string) {
  const barcode = keyword?.trim();
  if (!barcode) return undefined;
  const prisma = getPrisma();
  const item = await prisma.inventoryItem.findUnique({ where: { barcode }, select: { id: true } });
  if (item) return item.id;
  const correction = await prisma.barcodeCorrection.findUnique({
    where: { oldBarcode: barcode },
    select: { itemId: true }
  });
  return correction?.itemId;
}

function normalizePage(page?: number) {
  return Number.isFinite(page) && page && page > 0 ? Math.floor(page) : 1;
}

function normalizePageSize(pageSize?: number) {
  if (!Number.isFinite(pageSize) || !pageSize) return 20;
  return Math.min(100, Math.max(1, Math.floor(pageSize)));
}

function mapInboundSource(source: DbInboundSource): TrackingSource {
  if (source === "FACTORY") return "factory";
  if (source === "TERMINAL_RETURN") return "terminal_return";
  return "outbound_scan";
}

function mapOwnerType(type: DbInventoryItem["ownerType"]): OwnerType {
  return type === "WAREHOUSE" ? "warehouse" : "salesperson";
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

function mapInventoryItem(item: DbInventoryItem): InventoryItem {
  return {
    id: item.id,
    barcode: item.barcode,
    goodsId: item.goodsId,
    ownerType: mapOwnerType(item.ownerType),
    warehouseId: item.warehouseId ?? undefined,
    locationId: item.locationId ?? undefined,
    salespersonId: item.salespersonId ?? undefined,
    status:
      item.status === "IN_STOCK"
        ? "in_stock"
        : item.status === "WITH_SALESPERSON"
          ? "with_salesperson"
          : item.status === "WRITTEN_OFF"
            ? "written_off"
            : "voided",
    productionDate: formatDate(item.productionDate),
    shelfLifeDate: formatDate(item.shelfLifeDate),
    inboundSource: mapInboundSource(item.inboundSource),
    lastMovedAt: formatAppDateTime(item.lastMovedAt)
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
    occurredAt: formatAppDateTime(movement.occurredAt),
    note: movement.note
  };
}

function mapWarehouseStock(stock: DbWarehouseStock): WarehouseStock {
  return {
    id: stock.id,
    warehouseId: stock.warehouseId,
    goodsId: stock.goodsId,
    quantity: stock.quantity,
    lastChangedAt: formatAppDateTime(stock.lastChangedAt)
  };
}

function mapWarehouseStockMovement(movement: DbWarehouseStockMovement): WarehouseStockMovement {
  return {
    id: movement.id,
    warehouseId: movement.warehouseId,
    goodsId: movement.goodsId,
    type: mapMovementType(movement.type),
    quantityChange: movement.quantityChange,
    balanceAfter: movement.balanceAfter,
    orderKind: movement.orderKind ?? undefined,
    orderId: movement.orderId ?? undefined,
    barcode: movement.barcode ?? undefined,
    counterparty: movement.counterparty ?? undefined,
    operator: movement.operatorName,
    occurredAt: formatAppDateTime(movement.occurredAt),
    note: movement.note
  };
}
