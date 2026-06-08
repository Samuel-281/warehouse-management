import type { Prisma } from "@prisma/client";

type DbMovementType = "FACTORY_INBOUND" | "TERMINAL_RETURN_INBOUND" | "TRANSFER" | "SALES_OUTBOUND" | "SALES_RETURN";

export type AdjustWarehouseStockInput = {
  warehouseId: string;
  goodsId: string;
  quantityChange: number;
  type: DbMovementType;
  orderKind?: string;
  orderId?: string;
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

  const existing = await tx.warehouseStock.findUnique({
    where: {
      warehouseId_goodsId: {
        warehouseId: input.warehouseId,
        goodsId: input.goodsId
      }
    }
  });
  const currentQuantity = existing?.quantity ?? 0;
  const nextQuantity = currentQuantity + input.quantityChange;

  if (nextQuantity < 0) {
    throw new Error(`库存不足，当前可用 ${currentQuantity} 件`);
  }

  const stock = existing
    ? await tx.warehouseStock.update({
        where: { id: existing.id },
        data: {
          quantity: nextQuantity,
          lastChangedAt: input.occurredAt
        }
      })
    : await tx.warehouseStock.create({
        data: {
          warehouseId: input.warehouseId,
          goodsId: input.goodsId,
          quantity: nextQuantity,
          lastChangedAt: input.occurredAt
        }
      });

  await tx.warehouseStockMovement.create({
    data: {
      warehouseId: input.warehouseId,
      goodsId: input.goodsId,
      type: input.type,
      quantityChange: input.quantityChange,
      balanceAfter: nextQuantity,
      orderKind: input.orderKind,
      orderId: input.orderId,
      barcode: input.barcode,
      counterparty: input.counterparty,
      operatorName: input.operatorName,
      occurredAt: input.occurredAt,
      note: input.note
    }
  });

  return stock;
}
