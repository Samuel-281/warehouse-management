import { getPrisma } from "@/lib/db";
import { formatAppDateTime } from "@/lib/warehouse-utils";
import type { OrderKind, OrderSummary } from "@/lib/types";

export type DeleteOrderInput = {
  id: string;
  kind: OrderKind;
};

export async function listOrderSummaries(): Promise<OrderSummary[]> {
  const prisma = getPrisma();
  const [inboundOrders, outboundOrders, salesReturnOrders] = await Promise.all([
    prisma.inboundOrder.findMany({
      orderBy: { createdAt: "desc" },
      take: 80,
      include: {
        warehouse: true,
        location: true,
        terminalStore: true,
        items: { include: { goods: true }, orderBy: { barcode: "asc" } }
      }
    }),
    prisma.outboundOrder.findMany({
      orderBy: { createdAt: "desc" },
      take: 80,
      include: {
        sourceWarehouse: true,
        targetWarehouse: true,
        targetLocation: true,
        salesperson: true,
        items: { include: { goods: true }, orderBy: { barcode: "asc" } }
      }
    }),
    prisma.salesReturnOrder.findMany({
      orderBy: { createdAt: "desc" },
      take: 80,
      include: {
        returnWarehouse: true,
        returnLocation: true,
        items: { include: { goods: true, fromSalesperson: true }, orderBy: { barcode: "asc" } }
      }
    })
  ]);

  return [
    ...inboundOrders.map((order): OrderSummary => {
      const location = `${order.warehouse.name} / ${order.location.name}`;
      const barcodes = order.items.map((item) => item.barcode).filter((barcode): barcode is string => Boolean(barcode));
      const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
      return {
        id: order.id,
        orderNo: order.orderNo,
        kind: "inbound",
        businessType: order.source === "FACTORY" ? "厂家到货入库" : "终端店铺退换货入库",
        primaryTarget: location,
        counterparty: order.source === "TERMINAL_RETURN" ? order.terminalStore?.name ?? "终端店铺" : "厂家到货",
        operator: order.operatorName,
        createdAt: formatDateTime(order.createdAt),
        itemCount,
        goodsSummary: summarizeGoodsQuantities(order.items.map((item) => ({ name: item.goods.name, quantity: item.quantity }))),
        barcodePreview: summarizeBarcodes(barcodes),
        barcodes,
        status: order.status === "VOIDED" ? "voided" : "active",
        reversalSupported: order.reversalSupported,
        voidedAt: order.voidedAt ? formatDateTime(order.voidedAt) : undefined,
        voidedBy: order.voidedByName ?? undefined,
        voidReason: order.voidReason ?? undefined
      };
    }),
    ...outboundOrders.map((order): OrderSummary => {
      const isTransfer = order.type === "TRANSFER";
      const barcodes = order.items.map((item) => item.barcode);
      return {
        id: order.id,
        orderNo: order.orderNo,
        kind: "outbound",
        businessType: isTransfer ? "挪仓" : "销售出库",
        primaryTarget: order.sourceWarehouse.name,
        counterparty: isTransfer
          ? `${order.targetWarehouse?.name ?? "目标仓库"} / ${order.targetLocation?.name ?? "默认库位"}`
          : `销售人员：${order.salesperson?.name ?? "未知"}`,
        operator: order.operatorName,
        createdAt: formatDateTime(order.createdAt),
        itemCount: order.items.length,
        goodsSummary: summarizeGoods(order.items.map((item) => item.goods.name)),
        barcodePreview: summarizeBarcodes(barcodes),
        barcodes,
        status: order.status === "VOIDED" ? "voided" : "active",
        reversalSupported: order.reversalSupported,
        voidedAt: order.voidedAt ? formatDateTime(order.voidedAt) : undefined,
        voidedBy: order.voidedByName ?? undefined,
        voidReason: order.voidReason ?? undefined
      };
    }),
    ...salesReturnOrders.map((order): OrderSummary => {
      const barcodes = order.items.map((item) => item.barcode);
      return {
        id: order.id,
        orderNo: order.orderNo,
        kind: "sales_return",
        businessType: "销售退回",
        primaryTarget: `${order.returnWarehouse.name} / ${order.returnLocation.name}`,
        counterparty: summarizeSalespeople(order.items.map((item) => item.fromSalesperson.name)),
        operator: order.operatorName,
        createdAt: formatDateTime(order.createdAt),
        itemCount: order.items.length,
        goodsSummary: summarizeGoods(order.items.map((item) => item.goods.name)),
        barcodePreview: summarizeBarcodes(barcodes),
        barcodes,
        status: order.status === "VOIDED" ? "voided" : "active",
        reversalSupported: order.reversalSupported,
        voidedAt: order.voidedAt ? formatDateTime(order.voidedAt) : undefined,
        voidedBy: order.voidedByName ?? undefined,
        voidReason: order.voidReason ?? undefined
      };
    })
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function deleteOrders(input: DeleteOrderInput[]) {
  const orders = input.filter((order) => order.id && order.kind);
  if (orders.length === 0) {
    throw new Error("请选择需要删除的单据");
  }

  const inboundIds = orders.filter((order) => order.kind === "inbound").map((order) => order.id);
  const outboundIds = orders.filter((order) => order.kind === "outbound").map((order) => order.id);
  const salesReturnIds = orders.filter((order) => order.kind === "sales_return").map((order) => order.id);
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const [inboundCount, outboundCount, salesReturnCount] = await Promise.all([
      inboundIds.length > 0 ? tx.inboundOrder.count({ where: { id: { in: inboundIds } } }) : 0,
      outboundIds.length > 0 ? tx.outboundOrder.count({ where: { id: { in: outboundIds } } }) : 0,
      salesReturnIds.length > 0 ? tx.salesReturnOrder.count({ where: { id: { in: salesReturnIds } } }) : 0
    ]);

    if (inboundIds.length > 0) {
      await tx.inboundOrderItem.deleteMany({ where: { orderId: { in: inboundIds } } });
      await tx.inboundOrder.deleteMany({ where: { id: { in: inboundIds } } });
    }
    if (outboundIds.length > 0) {
      await tx.outboundOrderItem.deleteMany({ where: { orderId: { in: outboundIds } } });
      await tx.outboundOrder.deleteMany({ where: { id: { in: outboundIds } } });
    }
    if (salesReturnIds.length > 0) {
      await tx.salesReturnOrderItem.deleteMany({ where: { orderId: { in: salesReturnIds } } });
      await tx.salesReturnOrder.deleteMany({ where: { id: { in: salesReturnIds } } });
    }

    return { deleted: inboundCount + outboundCount + salesReturnCount };
  });
}

function summarizeGoods(names: string[]) {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([name, count]) => `${name} x${count}`)
    .join("、");
}

function summarizeGoodsQuantities(items: Array<{ name: string; quantity: number }>) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + item.quantity);
  return Array.from(counts.entries())
    .map(([name, count]) => `${name} x${count}`)
    .join("、");
}

function summarizeSalespeople(names: string[]) {
  const uniqueNames = Array.from(new Set(names));
  return uniqueNames.length > 0 ? `原销售人员：${uniqueNames.join("、")}` : "原销售人员：未知";
}

function summarizeBarcodes(barcodes: string[]) {
  if (barcodes.length === 0) return "无条码";
  if (barcodes.length <= 3) return barcodes.join("、");
  return `${barcodes.slice(0, 3).join("、")} 等 ${barcodes.length} 件`;
}

function formatDateTime(date: Date) {
  return formatAppDateTime(date);
}
