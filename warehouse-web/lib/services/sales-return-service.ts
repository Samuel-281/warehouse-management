import { assertBarcodeBatchLimit } from "@/lib/business-limits";
import { getPrisma } from "@/lib/db";
import { runIdempotentTransaction } from "@/lib/services/idempotency-service";
import { linkAndReconcileTerminalReceipts } from "@/lib/services/terminal-receipt-ownership-service";
import { adjustWarehouseStock } from "@/lib/services/warehouse-stock-service";

export type UnifiedReturnLine = {
  barcode: string;
  goodsId?: string;
};

export type SubmitSalesReturnInput = {
  returnWarehouseId: string;
  returnLocationId: string;
  barcodes?: string[];
  items?: UnifiedReturnLine[];
  operatorName: string;
  operatorUserId?: string;
  clientRequestId?: string;
};

export async function submitSalesReturn(input: SubmitSalesReturnInput) {
  const lines = normalizeLines(input);
  assertBarcodeBatchLimit(lines.map((line) => line.barcode));
  if (lines.length === 0) throw new Error("请先扫描或录入退回条码");

  const prisma = getPrisma();
  return runIdempotentTransaction(
    prisma,
    {
      userId: input.operatorUserId,
      operationType: "SALES_RETURN",
      clientRequestId: input.clientRequestId,
      payload: {
        returnWarehouseId: input.returnWarehouseId,
        returnLocationId: input.returnLocationId,
        items: lines
      }
    },
    async (tx) => {
      const [returnWarehouse, returnLocation] = await Promise.all([
        tx.warehouse.findUnique({ where: { id: input.returnWarehouseId } }),
        tx.storageLocation.findUnique({ where: { id: input.returnLocationId } })
      ]);
      if (!returnWarehouse) throw new Error("请选择有效的退回仓库");
      if (!returnLocation || returnLocation.warehouseId !== returnWarehouse.id) {
        throw new Error("请选择有效的退回库位");
      }

      const barcodes = lines.map((line) => line.barcode);
      const existingItems = await tx.inventoryItem.findMany({
        where: { barcode: { in: barcodes } },
        orderBy: { barcode: "asc" }
      });
      const existingByBarcode = new Map(existingItems.map((item) => [item.barcode, item]));
      const invalid = existingItems.find((item) => !isReturnable(item));
      if (invalid) {
        throw new Error(`条码 ${invalid.barcode} 已在仓库或处于不可退回状态`);
      }

      const missingLines = lines.filter((line) => !existingByBarcode.has(line.barcode));
      const missingGoodsId = missingLines.find((line) => !line.goodsId);
      if (missingGoodsId) throw new Error(`条码 ${missingGoodsId.barcode} 尚未建档，请先选择对应货物`);
      const goodsIds = Array.from(new Set(missingLines.map((line) => line.goodsId as string)));
      const goods = goodsIds.length > 0
        ? await tx.goods.findMany({ where: { id: { in: goodsIds }, status: "ENABLED" } })
        : [];
      const goodsIdSet = new Set(goods.map((item) => item.id));
      const invalidGoods = missingLines.find((line) => !goodsIdSet.has(line.goodsId as string));
      if (invalidGoods) throw new Error(`条码 ${invalidGoods.barcode} 选择的货物无效或已停用`);

      const time = new Date();
      const order = await tx.inboundOrder.create({
        data: {
          orderNo: makeOrderNo("TH"),
          source: "TERMINAL_RETURN",
          warehouseId: returnWarehouse.id,
          locationId: returnLocation.id,
          operatorName: input.operatorName,
          createdAt: time,
          reversalSupported: true
        }
      });

      if (missingLines.length > 0) {
        await tx.inventoryItem.createMany({
          data: missingLines.map((line) => ({
            barcode: line.barcode,
            goodsId: line.goodsId as string,
            ownerType: "WAREHOUSE",
            warehouseId: returnWarehouse.id,
            locationId: returnLocation.id,
            salespersonId: null,
            terminalStoreName: null,
            signedAt: null,
            status: "IN_STOCK",
            inboundSource: "TERMINAL_RETURN",
            lastMovedAt: time
          }))
        });
      }

      if (existingItems.length > 0) {
        const updated = await tx.inventoryItem.updateMany({
          where: {
            id: { in: existingItems.map((item) => item.id) },
            OR: [
              { ownerType: "SALESPERSON", status: "WITH_SALESPERSON" },
              { ownerType: "TERMINAL_STORE", status: "SIGNED" }
            ]
          },
          data: {
            ownerType: "WAREHOUSE",
            warehouseId: returnWarehouse.id,
            locationId: returnLocation.id,
            salespersonId: null,
            terminalStoreName: null,
            signedAt: null,
            status: "IN_STOCK",
            inboundSource: "TERMINAL_RETURN",
            lastMovedAt: time
          }
        });
        if (updated.count !== existingItems.length) {
          throw new Error("部分条码已被其他设备处理，请刷新条码校验后重试");
        }
      }

      const persistedItems = await tx.inventoryItem.findMany({
        where: { barcode: { in: barcodes } },
        orderBy: { barcode: "asc" }
      });
      if (persistedItems.length !== lines.length) throw new Error("退回条码写入不完整，请重试");

      const salespersonIds = Array.from(new Set(
        existingItems.flatMap((item) => item.salespersonId ? [item.salespersonId] : [])
      ));
      const salespersonNames = new Map(
        (await tx.salesperson.findMany({
          where: { id: { in: salespersonIds } },
          select: { id: true, name: true }
        })).map((person) => [person.id, person.name])
      );
      const toLabel = `${returnWarehouse.name} / ${returnLocation.name}`;
      const goodsQuantities = new Map<string, { quantity: number; pending: number; signed: number; unknown: number }>();
      for (const item of persistedItems) {
        const previous = existingByBarcode.get(item.barcode);
        const count = goodsQuantities.get(item.goodsId) ?? { quantity: 0, pending: 0, signed: 0, unknown: 0 };
        count.quantity += 1;
        if (!previous) count.unknown += 1;
        else if (previous.ownerType === "TERMINAL_STORE") count.signed += 1;
        else count.pending += 1;
        goodsQuantities.set(item.goodsId, count);
      }

      for (const [goodsId, count] of goodsQuantities.entries()) {
        await adjustWarehouseStock(tx, {
          warehouseId: returnWarehouse.id,
          goodsId,
          quantityChange: count.quantity,
          type: count.signed > 0 || count.unknown > 0 ? "TERMINAL_RETURN_INBOUND" : "SALES_RETURN",
          orderKind: "inbound",
          orderId: order.id,
          orderNo: order.orderNo,
          counterparty: returnCounterparty(count),
          operatorName: input.operatorName,
          occurredAt: time,
          note: "统一退回入库"
        });
      }

      await tx.stockMovement.createMany({
        data: persistedItems.map((item) => {
          const previous = existingByBarcode.get(item.barcode);
          return {
            itemId: item.id,
            barcode: item.barcode,
            goodsId: item.goodsId,
            type: previous?.ownerType === "SALESPERSON" ? "SALES_RETURN" as const : "TERMINAL_RETURN_INBOUND" as const,
            fromLabel: returnSourceLabel(previous, salespersonNames),
            toLabel,
            operatorName: input.operatorName,
            occurredAt: time,
            note: "统一退回入库，不要求生产日期",
            orderKind: "inbound",
            orderId: order.id,
            orderNo: order.orderNo
          };
        })
      });

      await tx.inboundOrderItem.createMany({
        data: persistedItems.map((item) => {
          const previous = existingByBarcode.get(item.barcode);
          return {
            orderId: order.id,
            inventoryItemId: item.id,
            barcode: item.barcode,
            goodsId: item.goodsId,
            quantity: 1,
            beforeOwnerType: previous?.ownerType,
            beforeWarehouseId: previous?.warehouseId,
            beforeLocationId: previous?.locationId,
            beforeSalespersonId: previous?.salespersonId,
            beforeTerminalStoreName: previous?.terminalStoreName,
            beforeSignedAt: previous?.signedAt,
            createdTrackingItem: !previous
          };
        })
      });

      await linkAndReconcileTerminalReceipts(
        tx,
        persistedItems.map((item) => ({ id: item.id, barcode: item.barcode }))
      );

      return {
        orderId: order.id,
        quantity: persistedItems.length,
        pendingCount: existingItems.filter((item) => item.ownerType === "SALESPERSON").length,
        signedCount: existingItems.filter((item) => item.ownerType === "TERMINAL_STORE").length,
        newTrackingCount: missingLines.length,
        items: persistedItems.map((item) => ({ id: item.id, barcode: item.barcode, goodsId: item.goodsId }))
      };
    }
  );
}

function normalizeLines(input: SubmitSalesReturnInput) {
  const source: UnifiedReturnLine[] = input.items ?? (input.barcodes ?? []).map((barcode) => ({ barcode }));
  const byBarcode = new Map<string, UnifiedReturnLine>();
  for (const line of source) {
    const barcode = line.barcode?.trim();
    if (!barcode) continue;
    if (!byBarcode.has(barcode)) byBarcode.set(barcode, { barcode, goodsId: line.goodsId || undefined });
  }
  return Array.from(byBarcode.values());
}

function isReturnable(item: { ownerType: string; status: string }) {
  return (
    (item.ownerType === "SALESPERSON" && item.status === "WITH_SALESPERSON") ||
    (item.ownerType === "TERMINAL_STORE" && item.status === "SIGNED")
  );
}

function returnSourceLabel(
  previous: { ownerType: string; salespersonId: string | null; terminalStoreName: string | null } | undefined,
  salespersonNames: Map<string, string>
) {
  if (!previous) return "外部退回（系统首次建档）";
  if (previous.ownerType === "TERMINAL_STORE") return `终端店铺：${previous.terminalStoreName ?? "未知店铺"}`;
  return `待签收货物 / 销售人员：${salespersonNames.get(previous.salespersonId ?? "") ?? "未知"}`;
}

function returnCounterparty(count: { pending: number; signed: number; unknown: number }) {
  const parts = [];
  if (count.pending) parts.push(`待签收 ${count.pending} 件`);
  if (count.signed) parts.push(`已签收 ${count.signed} 件`);
  if (count.unknown) parts.push(`首次建档 ${count.unknown} 件`);
  return parts.join("、") || "退回货物";
}

function makeOrderNo(prefix: string) {
  const random = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `${prefix}${Date.now()}${random}`;
}
