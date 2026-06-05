import type { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/db";
import { formatAppDateTime } from "@/lib/warehouse-utils";
import type {
  InboundSource,
  InventoryDetailResult,
  InventoryItem,
  InventoryListResult,
  InventorySummary,
  MovementType,
  OwnerType,
  StockMovement
} from "@/lib/types";

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

export type InventoryQueryInput = {
  keyword?: string;
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
  const where = buildInventoryWhere(input);

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

  const barcodes = items.map((item) => item.barcode);
  const latestMovements = await latestMovementForBarcodes(barcodes);

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
  const item = await prisma.inventoryItem.findUnique({ where: { barcode } });
  if (!item) {
    throw new Error(`条码 ${barcode} 不存在`);
  }

  const movements = await prisma.stockMovement.findMany({
    where: { barcode },
    orderBy: { occurredAt: "desc" }
  });

  return {
    item: mapInventoryItem(item),
    movements: movements.map(mapStockMovement)
  };
}

export async function deleteInventoryItemByBarcode(barcode: string) {
  const normalizedBarcode = barcode.trim();
  if (!normalizedBarcode) throw new Error("请选择需要删除的条码");

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.findUnique({ where: { barcode: normalizedBarcode } });
    if (!item) throw new Error(`条码 ${normalizedBarcode} 不存在`);

    const [inboundItems, outboundItems, salesReturnItems] = await Promise.all([
      tx.inboundOrderItem.findMany({ where: { inventoryItemId: item.id }, select: { orderId: true } }),
      tx.outboundOrderItem.findMany({ where: { inventoryItemId: item.id }, select: { orderId: true } }),
      tx.salesReturnOrderItem.findMany({ where: { inventoryItemId: item.id }, select: { orderId: true } })
    ]);
    const inboundOrderIds = inboundItems.map((entry) => entry.orderId);
    const outboundOrderIds = outboundItems.map((entry) => entry.orderId);
    const salesReturnOrderIds = salesReturnItems.map((entry) => entry.orderId);

    await tx.inboundOrderItem.deleteMany({ where: { inventoryItemId: item.id } });
    await tx.outboundOrderItem.deleteMany({ where: { inventoryItemId: item.id } });
    await tx.salesReturnOrderItem.deleteMany({ where: { inventoryItemId: item.id } });
    await tx.stockMovement.deleteMany({ where: { itemId: item.id } });
    await tx.inventoryItem.delete({ where: { id: item.id } });

    if (inboundOrderIds.length > 0) {
      await tx.inboundOrder.deleteMany({ where: { id: { in: inboundOrderIds }, items: { none: {} } } });
    }
    if (outboundOrderIds.length > 0) {
      await tx.outboundOrder.deleteMany({ where: { id: { in: outboundOrderIds }, items: { none: {} } } });
    }
    if (salesReturnOrderIds.length > 0) {
      await tx.salesReturnOrder.deleteMany({ where: { id: { in: salesReturnOrderIds }, items: { none: {} } } });
    }

    return { deleted: true };
  });
}

export async function getInventorySummary(): Promise<InventorySummary> {
  const prisma = getPrisma();
  const [totalItems, inStock, withSales, warehouseGroups, salespersonGroups, recentMovements] =
    await Promise.all([
      prisma.inventoryItem.count(),
      prisma.inventoryItem.count({ where: { ownerType: "WAREHOUSE" } }),
      prisma.inventoryItem.count({ where: { ownerType: "SALESPERSON" } }),
      prisma.inventoryItem.groupBy({
        by: ["warehouseId"],
        where: { ownerType: "WAREHOUSE", warehouseId: { not: null } },
        _count: { _all: true }
      }),
      prisma.inventoryItem.groupBy({
        by: ["salespersonId"],
        where: { ownerType: "SALESPERSON", salespersonId: { not: null } },
        _count: { _all: true }
      }),
      prisma.stockMovement.findMany({
        orderBy: { occurredAt: "desc" },
        take: 8
      })
    ]);
  const warehouseCounts = warehouseGroups
    .filter((group) => group.warehouseId)
    .map((group) => ({ warehouseId: group.warehouseId as string, count: group._count._all }));

  return {
    totalItems,
    inStock,
    withSales,
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

  const prisma = getPrisma();
  const items = await prisma.inventoryItem.findMany({ where: { barcode: { in: barcodes } } });
  const itemByBarcode = new Map(items.map((item) => [item.barcode, item]));

  return barcodes.map((barcode) => {
    const item = itemByBarcode.get(barcode);
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

    if (!item) return { barcode, ok: false, label: "不存在", detail: "系统内未找到该条码" };

    if (input.mode === "warehouse_outbound") {
      if (item.ownerType !== "WAREHOUSE" || item.warehouseId !== input.warehouseId) {
        return { barcode, ok: false, label: "仓库不符", detail: "条码当前不在所选仓库库存中", item: mapInventoryItem(item) };
      }
      return { barcode, ok: true, label: "可出库", detail: "条码当前在所选仓库库存中", item: mapInventoryItem(item) };
    }

    if (item.ownerType !== "SALESPERSON" || !item.salespersonId) {
      return { barcode, ok: false, label: "不可退回", detail: "条码当前不在销售人员名下", item: mapInventoryItem(item) };
    }
    return { barcode, ok: true, label: "可退回", detail: "条码当前在销售人员名下", item: mapInventoryItem(item) };
  });
}

function buildInventoryWhere(input: InventoryQueryInput): Prisma.InventoryItemWhereInput {
  const where: Prisma.InventoryItemWhereInput = {};
  const keyword = input.keyword?.trim();

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

async function latestMovementForBarcodes(barcodes: string[]) {
  if (barcodes.length === 0) return [];
  const prisma = getPrisma();
  const movements = await prisma.stockMovement.findMany({
    where: { barcode: { in: barcodes } },
    orderBy: [{ barcode: "asc" }, { occurredAt: "desc" }]
  });
  const seen = new Set<string>();
  const latest: StockMovement[] = [];
  for (const movement of movements) {
    if (seen.has(movement.barcode)) continue;
    seen.add(movement.barcode);
    latest.push(mapStockMovement(movement));
  }
  return latest;
}

function normalizePage(page?: number) {
  return Number.isFinite(page) && page && page > 0 ? Math.floor(page) : 1;
}

function normalizePageSize(pageSize?: number) {
  if (!Number.isFinite(pageSize) || !pageSize) return 20;
  return Math.min(100, Math.max(1, Math.floor(pageSize)));
}

function mapInboundSource(source: DbInboundSource): InboundSource {
  return source === "FACTORY" ? "factory" : "terminal_return";
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
    SALES_RETURN: "sales_return"
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
    status: item.status === "IN_STOCK" ? "in_stock" : "with_salesperson",
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
