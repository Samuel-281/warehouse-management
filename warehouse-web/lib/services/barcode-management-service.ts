import type { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/db";
import { adjustWarehouseStock } from "@/lib/services/warehouse-stock-service";

export type CorrectBarcodeInput = {
  barcode: string;
  newBarcode: string;
  reason: string;
  operatorName: string;
};

export type WriteOffBarcodeInput = {
  barcode: string;
  reason: string;
  operatorName: string;
};

export async function correctBarcode(input: CorrectBarcodeInput) {
  const barcode = normalizeBarcode(input.barcode);
  const newBarcode = normalizeBarcode(input.newBarcode);
  const reason = normalizeReason(input.reason);
  if (barcode === newBarcode) throw new Error("新条码不能与原条码相同");

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.findUnique({ where: { barcode } });
    if (!item) throw new Error(`条码 ${barcode} 不存在`);
    if (item.status !== "IN_STOCK" && item.status !== "WITH_SALESPERSON") {
      throw new Error("已核销或已撤销的条码不能更正");
    }

    const [currentConflict, historyConflict] = await Promise.all([
      tx.inventoryItem.findUnique({ where: { barcode: newBarcode } }),
      tx.barcodeCorrection.findFirst({
        where: { OR: [{ oldBarcode: newBarcode }, { newBarcode }] },
        select: { id: true }
      })
    ]);
    if (currentConflict || historyConflict) throw new Error(`条码 ${newBarcode} 已被使用，不能重复`);

    const time = new Date();
    await tx.inventoryItem.update({
      where: { id: item.id },
      data: { barcode: newBarcode, lastMovedAt: time }
    });
    const correction = await tx.barcodeCorrection.create({
      data: {
        itemId: item.id,
        oldBarcode: barcode,
        newBarcode,
        reason,
        operatorName: input.operatorName,
        occurredAt: time
      }
    });
    await tx.stockMovement.create({
      data: {
        itemId: item.id,
        barcode: newBarcode,
        goodsId: item.goodsId,
        type: "BARCODE_CORRECTION",
        fromLabel: `原条码：${barcode}`,
        toLabel: `新条码：${newBarcode}`,
        operatorName: input.operatorName,
        occurredAt: time,
        note: `条码更正：${reason}`
      }
    });

    return { corrected: true, barcode: newBarcode, correctionId: correction.id };
  });
}

export async function writeOffBarcode(input: WriteOffBarcodeInput) {
  const barcode = normalizeBarcode(input.barcode);
  const reason = normalizeReason(input.reason);
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.findUnique({ where: { barcode } });
    if (!item) throw new Error(`条码 ${barcode} 不存在`);
    if (item.status !== "IN_STOCK" && item.status !== "WITH_SALESPERSON") {
      throw new Error("该条码已经核销或撤销，不能重复处理");
    }

    const time = new Date();
    const fromLabel = await ownerLabel(tx, item);
    if (item.status === "IN_STOCK" && item.warehouseId) {
      await adjustWarehouseStock(tx, {
        warehouseId: item.warehouseId,
        goodsId: item.goodsId,
        quantityChange: -1,
        type: "WRITE_OFF",
        barcode: item.barcode,
        counterparty: "货物核销",
        operatorName: input.operatorName,
        occurredAt: time,
        note: `货物核销：${reason}`
      });
    }

    await tx.inventoryItem.update({
      where: { id: item.id },
      data: { status: "WRITTEN_OFF", lastMovedAt: time }
    });
    await tx.stockMovement.create({
      data: {
        itemId: item.id,
        barcode: item.barcode,
        goodsId: item.goodsId,
        type: "WRITE_OFF",
        fromLabel,
        toLabel: "已核销",
        operatorName: input.operatorName,
        occurredAt: time,
        note: `货物核销：${reason}`
      }
    });

    return { writtenOff: true, barcode: item.barcode, warehouseQuantityChanged: item.status === "IN_STOCK" };
  });
}

function normalizeBarcode(value: string) {
  const barcode = value?.trim();
  if (!barcode) throw new Error("条码不能为空");
  if (barcode.length > 128) throw new Error("条码长度不能超过 128 个字符");
  return barcode;
}

function normalizeReason(value: string) {
  const reason = value?.trim();
  if (!reason || reason.length < 2) throw new Error("请填写至少 2 个字符的处理原因");
  if (reason.length > 200) throw new Error("处理原因不能超过 200 个字符");
  return reason;
}

async function ownerLabel(
  tx: Prisma.TransactionClient,
  item: { ownerType: "WAREHOUSE" | "SALESPERSON"; warehouseId: string | null; locationId: string | null; salespersonId: string | null }
) {
  if (item.ownerType === "SALESPERSON" && item.salespersonId) {
    const salesperson = await tx.salesperson.findUnique({ where: { id: item.salespersonId }, select: { name: true } });
    return `销售人员：${salesperson?.name ?? "未知"}`;
  }
  if (item.warehouseId) {
    const [warehouse, location] = await Promise.all([
      tx.warehouse.findUnique({ where: { id: item.warehouseId }, select: { name: true } }),
      item.locationId ? tx.storageLocation.findUnique({ where: { id: item.locationId }, select: { name: true } }) : null
    ]);
    return `${warehouse?.name ?? "未知仓库"}${location ? ` / ${location.name}` : ""}`;
  }
  return "未知归属";
}
