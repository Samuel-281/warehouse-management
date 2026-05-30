import { getPrisma } from "@/lib/db";
import type { OrderSummary } from "@/lib/types";

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
      return {
        id: order.id,
        orderNo: order.orderNo,
        kind: "inbound",
        businessType: order.source === "FACTORY" ? "厂家到货入库" : "终端店铺退换货入库",
        primaryTarget: location,
        counterparty: order.source === "TERMINAL_RETURN" ? order.terminalStore?.name ?? "终端店铺" : "厂家到货",
        operator: order.operatorName,
        createdAt: formatDateTime(order.createdAt),
        itemCount: order.items.length,
        goodsSummary: summarizeGoods(order.items.map((item) => item.goods.name)),
        barcodePreview: summarizeBarcodes(order.items.map((item) => item.barcode))
      };
    }),
    ...outboundOrders.map((order): OrderSummary => {
      const isTransfer = order.type === "TRANSFER";
      return {
        id: order.id,
        orderNo: order.orderNo,
        kind: "outbound",
        businessType: isTransfer ? "挪仓" : "销售出库",
        primaryTarget: order.sourceWarehouse.name,
        counterparty: isTransfer
          ? `${order.targetWarehouse?.name ?? "目标分仓"} / ${order.targetLocation?.name ?? "默认库位"}`
          : `销售人员：${order.salesperson?.name ?? "未知"}`,
        operator: order.operatorName,
        createdAt: formatDateTime(order.createdAt),
        itemCount: order.items.length,
        goodsSummary: summarizeGoods(order.items.map((item) => item.goods.name)),
        barcodePreview: summarizeBarcodes(order.items.map((item) => item.barcode))
      };
    }),
    ...salesReturnOrders.map((order): OrderSummary => ({
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
      barcodePreview: summarizeBarcodes(order.items.map((item) => item.barcode))
    }))
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function summarizeGoods(names: string[]) {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([name, count]) => `${name} x${count}`)
    .join("、");
}

function summarizeSalespeople(names: string[]) {
  const uniqueNames = Array.from(new Set(names));
  return uniqueNames.length > 0 ? `原销售人员：${uniqueNames.join("、")}` : "原销售人员：未知";
}

function summarizeBarcodes(barcodes: string[]) {
  if (barcodes.length <= 3) return barcodes.join("、");
  return `${barcodes.slice(0, 3).join("、")} 等 ${barcodes.length} 件`;
}

function formatDateTime(date: Date) {
  return date.toISOString().slice(0, 16).replace("T", " ");
}
