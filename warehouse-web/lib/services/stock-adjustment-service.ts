import { getPrisma } from "@/lib/db";
import { adjustWarehouseStock } from "@/lib/services/warehouse-stock-service";

export type ManualStockAdjustmentInput = {
  warehouseId: string;
  goodsId: string;
  quantityChange: number;
  reason: string;
  operatorName: string;
};

export async function adjustStockManually(input: ManualStockAdjustmentInput) {
  if (!Number.isInteger(input.quantityChange) || input.quantityChange === 0) {
    throw new Error("修正数量必须为非零整数");
  }
  if (Math.abs(input.quantityChange) > 100000) throw new Error("单次修正数量不能超过 100000 件");
  const reason = input.reason?.trim();
  if (!reason || reason.length < 2) throw new Error("请填写至少 2 个字符的修正原因");
  if (reason.length > 200) throw new Error("修正原因不能超过 200 个字符");

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const [warehouse, goods] = await Promise.all([
      tx.warehouse.findUnique({ where: { id: input.warehouseId } }),
      tx.goods.findUnique({ where: { id: input.goodsId } })
    ]);
    if (!warehouse) throw new Error("请选择有效的仓库");
    if (!goods) throw new Error("请选择有效的货物");

    const stock = await adjustWarehouseStock(tx, {
      warehouseId: warehouse.id,
      goodsId: goods.id,
      quantityChange: input.quantityChange,
      type: "MANUAL_ADJUSTMENT",
      counterparty: "超级管理员人工修正",
      operatorName: input.operatorName,
      occurredAt: new Date(),
      note: `人工库存修正：${reason}`
    });

    return {
      adjusted: true,
      warehouseId: warehouse.id,
      goodsId: goods.id,
      quantity: stock.quantity,
      quantityChange: input.quantityChange
    };
  });
}
