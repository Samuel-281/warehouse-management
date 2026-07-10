import type { Prisma } from "@prisma/client";

type DbMovementType =
  | "FACTORY_INBOUND"
  | "TERMINAL_RETURN_INBOUND"
  | "TRANSFER"
  | "SALES_OUTBOUND"
  | "SALES_RETURN"
  | "ORDER_REVERSAL"
  | "WRITE_OFF"
  | "MANUAL_ADJUSTMENT";

export type AdjustWarehouseStockInput = {
  warehouseId: string;
  goodsId: string;
  quantityChange: number;
  type: DbMovementType;
  orderKind?: string;
  orderId?: string;
  orderNo?: string;
  reversalOfMovementId?: string;
  barcode?: string;
  counterparty?: string;
  operatorName: string;
  occurredAt: Date;
  note: string;
};

export async function adjustWarehouseStock(tx: Prisma.TransactionClient, input: AdjustWarehouseStockInput) {
  if (!Number.isInteger(input.quantityChange) || input.quantityChange === 0) {
    throw new Error("库存变动数量必须为非零整数");
  }

  const stockKey = {
    warehouseId_goodsId: {
      warehouseId: input.warehouseId,
      goodsId: input.goodsId
    }
  };

  if (input.quantityChange < 0) {
    const decrement = Math.abs(input.quantityChange);
    const updated = await tx.warehouseStock.updateMany({
      where: {
        warehouseId: input.warehouseId,
        goodsId: input.goodsId,
        quantity: { gte: decrement }
      },
      data: {
        quantity: { decrement },
        lastChangedAt: input.occurredAt
      }
    });

    if (updated.count !== 1) {
      const current = await tx.warehouseStock.findUnique({ where: stockKey });
      throw new Error(`库存不足，当前可用 ${current?.quantity ?? 0} 件`);
    }
  } else {
    await tx.warehouseStock.upsert({
      where: stockKey,
      create: {
        warehouseId: input.warehouseId,
        goodsId: input.goodsId,
        quantity: input.quantityChange,
        lastChangedAt: input.occurredAt
      },
      update: {
        quantity: { increment: input.quantityChange },
        lastChangedAt: input.occurredAt
      }
    });
  }

  const stock = await tx.warehouseStock.findUnique({ where: stockKey });
  if (!stock) throw new Error("库存更新失败，请重试");

  await tx.warehouseStockMovement.create({
    data: {
      warehouseId: input.warehouseId,
      goodsId: input.goodsId,
      type: input.type,
      quantityChange: input.quantityChange,
      balanceAfter: stock.quantity,
      orderKind: input.orderKind,
      orderId: input.orderId,
      orderNo: input.orderNo,
      reversalOfMovementId: input.reversalOfMovementId,
      barcode: input.barcode,
      counterparty: input.counterparty,
      operatorName: input.operatorName,
      occurredAt: input.occurredAt,
      note: input.note
    }
  });

  return stock;
}
