import { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/db";
import { formatAppDateTime } from "@/lib/warehouse-utils";
import type { OrderKind, OrderListResult, OrderStatus, OrderSummary } from "@/lib/types";

export type OrderStatusFilter = OrderStatus | "all";

export type OrderQueryInput = {
  kind?: OrderKind | "all";
  status?: OrderStatusFilter;
  barcode?: string;
  page?: number;
  pageSize?: number;
};

export type OrderReference = {
  id: string;
  kind: OrderKind;
};

type CandidateRow = {
  id: string;
  kind: OrderKind;
  createdAt: Date;
};

type CountRow = {
  kind: OrderKind;
  count: number;
};

type OrderItemAggregateRow = {
  orderId: string;
  itemCount: number;
  goodsSummary: string;
  barcodes: string[];
  counterparty: string | null;
};

export async function listOrderSummaries(input: OrderQueryInput = {}): Promise<OrderListResult> {
  const prisma = getPrisma();
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const union = buildOrderUnion(input);
  const offset = (page - 1) * pageSize;

  const [candidateRows, countRows] = await Promise.all([
    prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      WITH candidates AS (${union})
      SELECT id, kind, "createdAt"
      FROM candidates
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `),
    prisma.$queryRaw<CountRow[]>(Prisma.sql`
      WITH candidates AS (${union})
      SELECT kind, COUNT(*)::integer AS count
      FROM candidates
      GROUP BY kind
    `)
  ]);

  const summaries = await loadListSummaries(candidateRows.map(({ id, kind }) => ({ id, kind })));
  const summaryByKey = new Map(summaries.map((summary) => [`${summary.kind}:${summary.id}`, summary]));
  const items = candidateRows
    .map((row) => summaryByKey.get(`${row.kind}:${row.id}`))
    .filter((summary): summary is OrderSummary => Boolean(summary))
    .map((summary) => ({ ...summary, barcodes: summary.barcodes.slice(0, 3) }));
  const countMap = new Map(countRows.map((row) => [row.kind, Number(row.count)]));
  const counts = {
    inbound: countMap.get("inbound") ?? 0,
    outbound: countMap.get("outbound") ?? 0,
    salesReturn: countMap.get("sales_return") ?? 0
  };

  return {
    items,
    total: counts.inbound + counts.outbound + counts.salesReturn,
    counts,
    page,
    pageSize
  };
}

export async function getOrderDetail(reference: OrderReference) {
  const [summary] = await loadSummaries([reference]);
  if (!summary) throw new Error("单据不存在");
  return summary;
}

export async function exportOrdersCsv(references: OrderReference[]) {
  const normalized = uniqueReferences(references);
  if (normalized.length === 0) throw new Error("请选择需要导出的单据");
  if (normalized.length > 50) throw new Error("单次最多导出 50 张单据");
  const summaries = await loadSummaries(normalized);
  const summaryByKey = new Map(summaries.map((summary) => [`${summary.kind}:${summary.id}`, summary]));
  const ordered = normalized
    .map((reference) => summaryByKey.get(`${reference.kind}:${reference.id}`))
    .filter((summary): summary is OrderSummary => Boolean(summary));
  if (ordered.length !== normalized.length) throw new Error("部分单据不存在或已无法读取");

  const rows: string[][] = [["单据号", "单据类型", "业务类型", "状态", "来源 / 去向", "往来方", "数量", "货物", "条码", "操作人", "创建时间"]];
  for (const order of ordered) {
    const barcodes = order.barcodes.length > 0 ? order.barcodes : ["-"];
    for (const barcode of barcodes) {
      rows.push([
        order.orderNo,
        formatOrderKind(order.kind),
        order.businessType,
        order.status === "voided" ? "已作废" : "正常",
        order.primaryTarget,
        order.counterparty ?? "-",
        String(order.itemCount),
        order.goodsSummary || "-",
        barcode,
        order.operator,
        order.createdAt
      ]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

async function loadListSummaries(references: OrderReference[]): Promise<OrderSummary[]> {
  const normalized = uniqueReferences(references);
  if (normalized.length === 0) return [];
  const prisma = getPrisma();
  const inboundIds = normalized.filter((item) => item.kind === "inbound").map((item) => item.id);
  const outboundIds = normalized.filter((item) => item.kind === "outbound").map((item) => item.id);
  const returnIds = normalized.filter((item) => item.kind === "sales_return").map((item) => item.id);

  const [inboundOrders, outboundOrders, salesReturnOrders, inboundAggregates, outboundAggregates, returnAggregates] =
    await Promise.all([
      inboundIds.length
        ? prisma.inboundOrder.findMany({
            where: { id: { in: inboundIds } },
            include: { warehouse: true, location: true, terminalStore: true }
          })
        : [],
      outboundIds.length
        ? prisma.outboundOrder.findMany({
            where: { id: { in: outboundIds } },
            include: { sourceWarehouse: true, targetWarehouse: true, targetLocation: true, salesperson: true }
          })
        : [],
      returnIds.length
        ? prisma.salesReturnOrder.findMany({
            where: { id: { in: returnIds } },
            include: { returnWarehouse: true, returnLocation: true }
          })
        : [],
      loadInboundListAggregates(inboundIds),
      loadOutboundListAggregates(outboundIds),
      loadSalesReturnListAggregates(returnIds)
    ]);

  const inboundById = new Map(inboundAggregates.map((item) => [item.orderId, item]));
  const outboundById = new Map(outboundAggregates.map((item) => [item.orderId, item]));
  const returnById = new Map(returnAggregates.map((item) => [item.orderId, item]));

  return [
    ...inboundOrders.map((order): OrderSummary => {
      const aggregate = requiredAggregate(inboundById, order.id);
      return {
        id: order.id,
        orderNo: order.orderNo,
        kind: "inbound",
        businessType: order.source === "FACTORY" ? "厂家到货入库" : "退回入库",
        primaryTarget: `${order.warehouse.name} / ${order.location.name}`,
        counterparty: order.source === "TERMINAL_RETURN" ? order.terminalStore?.name ?? "自动识别退回来源" : "厂家到货",
        operator: order.operatorName,
        createdAt: formatDateTime(order.createdAt),
        itemCount: aggregate.itemCount,
        goodsSummary: aggregate.goodsSummary,
        barcodePreview: summarizeBarcodes(aggregate.barcodes),
        barcodes: aggregate.barcodes,
        ...voidFields(order)
      };
    }),
    ...outboundOrders.map((order): OrderSummary => {
      const aggregate = requiredAggregate(outboundById, order.id);
      const isTransfer = order.type === "TRANSFER";
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
        itemCount: aggregate.itemCount,
        goodsSummary: aggregate.goodsSummary,
        barcodePreview: summarizeBarcodes(aggregate.barcodes),
        barcodes: aggregate.barcodes,
        ...voidFields(order)
      };
    }),
    ...salesReturnOrders.map((order): OrderSummary => {
      const aggregate = requiredAggregate(returnById, order.id);
      return {
        id: order.id,
        orderNo: order.orderNo,
        kind: "sales_return",
        businessType: "退回入库（历史）",
        primaryTarget: `${order.returnWarehouse.name} / ${order.returnLocation.name}`,
        counterparty: aggregate.counterparty ? `原销售人员：${aggregate.counterparty}` : "原销售人员：未知",
        operator: order.operatorName,
        createdAt: formatDateTime(order.createdAt),
        itemCount: aggregate.itemCount,
        goodsSummary: aggregate.goodsSummary,
        barcodePreview: summarizeBarcodes(aggregate.barcodes),
        barcodes: aggregate.barcodes,
        ...voidFields(order)
      };
    })
  ];
}

async function loadInboundListAggregates(orderIds: string[]) {
  if (orderIds.length === 0) return [];
  return getPrisma().$queryRaw<OrderItemAggregateRow[]>(Prisma.sql`
    WITH goods_totals AS (
      SELECT item."orderId", goods.name, SUM(item.quantity)::integer AS quantity
      FROM "inbound_order_items" AS item
      JOIN goods ON goods.id = item."goodsId"
      WHERE item."orderId" IN (${Prisma.join(orderIds)})
      GROUP BY item."orderId", goods.name
    ), totals AS (
      SELECT "orderId", SUM(quantity)::integer AS "itemCount",
        string_agg(name || ' x' || quantity::text, '、' ORDER BY name) AS "goodsSummary"
      FROM goods_totals
      GROUP BY "orderId"
    ), previews AS (
      SELECT "orderId", (array_agg(barcode ORDER BY barcode) FILTER (WHERE barcode IS NOT NULL))[1:3] AS barcodes
      FROM "inbound_order_items"
      WHERE "orderId" IN (${Prisma.join(orderIds)})
      GROUP BY "orderId"
    )
    SELECT totals."orderId", totals."itemCount", totals."goodsSummary",
      COALESCE(previews.barcodes, ARRAY[]::text[]) AS barcodes, NULL::text AS counterparty
    FROM totals
    LEFT JOIN previews USING ("orderId")
  `);
}

async function loadOutboundListAggregates(orderIds: string[]) {
  if (orderIds.length === 0) return [];
  return getPrisma().$queryRaw<OrderItemAggregateRow[]>(Prisma.sql`
    WITH goods_totals AS (
      SELECT item."orderId", goods.name, COUNT(*)::integer AS quantity
      FROM "outbound_order_items" AS item
      JOIN goods ON goods.id = item."goodsId"
      WHERE item."orderId" IN (${Prisma.join(orderIds)})
      GROUP BY item."orderId", goods.name
    ), totals AS (
      SELECT "orderId", SUM(quantity)::integer AS "itemCount",
        string_agg(name || ' x' || quantity::text, '、' ORDER BY name) AS "goodsSummary"
      FROM goods_totals
      GROUP BY "orderId"
    ), previews AS (
      SELECT "orderId", (array_agg(barcode ORDER BY barcode))[1:3] AS barcodes
      FROM "outbound_order_items"
      WHERE "orderId" IN (${Prisma.join(orderIds)})
      GROUP BY "orderId"
    )
    SELECT totals."orderId", totals."itemCount", totals."goodsSummary", previews.barcodes,
      NULL::text AS counterparty
    FROM totals
    JOIN previews USING ("orderId")
  `);
}

async function loadSalesReturnListAggregates(orderIds: string[]) {
  if (orderIds.length === 0) return [];
  return getPrisma().$queryRaw<OrderItemAggregateRow[]>(Prisma.sql`
    WITH goods_totals AS (
      SELECT item."orderId", goods.name, COUNT(*)::integer AS quantity
      FROM "sales_return_order_items" AS item
      JOIN goods ON goods.id = item."goodsId"
      WHERE item."orderId" IN (${Prisma.join(orderIds)})
      GROUP BY item."orderId", goods.name
    ), totals AS (
      SELECT "orderId", SUM(quantity)::integer AS "itemCount",
        string_agg(name || ' x' || quantity::text, '、' ORDER BY name) AS "goodsSummary"
      FROM goods_totals
      GROUP BY "orderId"
    ), details AS (
      SELECT item."orderId", (array_agg(item.barcode ORDER BY item.barcode))[1:3] AS barcodes,
        string_agg(DISTINCT person.name, '、' ORDER BY person.name) AS counterparty
      FROM "sales_return_order_items" AS item
      LEFT JOIN salespeople AS person ON person.id = item."fromSalespersonId"
      WHERE item."orderId" IN (${Prisma.join(orderIds)})
      GROUP BY item."orderId"
    )
    SELECT totals."orderId", totals."itemCount", totals."goodsSummary", details.barcodes, details.counterparty
    FROM totals
    JOIN details USING ("orderId")
  `);
}

function requiredAggregate(aggregates: Map<string, OrderItemAggregateRow>, orderId: string) {
  const aggregate = aggregates.get(orderId);
  if (!aggregate) throw new Error(`单据 ${orderId} 的明细摘要缺失`);
  return aggregate;
}

async function loadSummaries(references: OrderReference[]): Promise<OrderSummary[]> {
  const normalized = uniqueReferences(references);
  if (normalized.length === 0) return [];
  const prisma = getPrisma();
  const inboundIds = normalized.filter((item) => item.kind === "inbound").map((item) => item.id);
  const outboundIds = normalized.filter((item) => item.kind === "outbound").map((item) => item.id);
  const returnIds = normalized.filter((item) => item.kind === "sales_return").map((item) => item.id);

  const [inboundOrders, outboundOrders, salesReturnOrders] = await Promise.all([
    inboundIds.length
      ? prisma.inboundOrder.findMany({
          where: { id: { in: inboundIds } },
          include: {
            warehouse: true,
            location: true,
            terminalStore: true,
            items: { include: { goods: true }, orderBy: { barcode: "asc" } }
          }
        })
      : [],
    outboundIds.length
      ? prisma.outboundOrder.findMany({
          where: { id: { in: outboundIds } },
          include: {
            sourceWarehouse: true,
            targetWarehouse: true,
            targetLocation: true,
            salesperson: true,
            items: { include: { goods: true }, orderBy: { barcode: "asc" } }
          }
        })
      : [],
    returnIds.length
      ? prisma.salesReturnOrder.findMany({
          where: { id: { in: returnIds } },
          include: {
            returnWarehouse: true,
            returnLocation: true,
            items: { include: { goods: true, fromSalesperson: true }, orderBy: { barcode: "asc" } }
          }
        })
      : []
  ]);

  return [
    ...inboundOrders.map((order): OrderSummary => {
      const barcodes = order.items.map((item) => item.barcode).filter((barcode): barcode is string => Boolean(barcode));
      return {
        id: order.id,
        orderNo: order.orderNo,
        kind: "inbound",
        businessType: order.source === "FACTORY" ? "厂家到货入库" : "退回入库",
        primaryTarget: `${order.warehouse.name} / ${order.location.name}`,
        counterparty: order.source === "TERMINAL_RETURN" ? order.terminalStore?.name ?? "自动识别退回来源" : "厂家到货",
        operator: order.operatorName,
        createdAt: formatDateTime(order.createdAt),
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        goodsSummary: summarizeGoodsQuantities(order.items.map((item) => ({ name: item.goods.name, quantity: item.quantity }))),
        barcodePreview: summarizeBarcodes(barcodes),
        barcodes,
        ...voidFields(order)
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
        ...voidFields(order)
      };
    }),
    ...salesReturnOrders.map((order): OrderSummary => {
      const barcodes = order.items.map((item) => item.barcode);
      return {
        id: order.id,
        orderNo: order.orderNo,
        kind: "sales_return",
        businessType: "退回入库（历史）",
        primaryTarget: `${order.returnWarehouse.name} / ${order.returnLocation.name}`,
        counterparty: summarizeSalespeople(order.items.map((item) => item.fromSalesperson.name)),
        operator: order.operatorName,
        createdAt: formatDateTime(order.createdAt),
        itemCount: order.items.length,
        goodsSummary: summarizeGoods(order.items.map((item) => item.goods.name)),
        barcodePreview: summarizeBarcodes(barcodes),
        barcodes,
        ...voidFields(order)
      };
    })
  ];
}

function buildOrderUnion(input: OrderQueryInput) {
  const kind = normalizeKind(input.kind);
  const status = normalizeStatus(input.status);
  const barcode = input.barcode?.trim() ?? "";
  if (barcode.length > 128) throw new Error("条码长度不能超过 128 个字符");
  const selects: Prisma.Sql[] = [];

  if (kind === "all" || kind === "inbound") {
    selects.push(Prisma.sql`
      SELECT order_row.id, 'inbound'::text AS kind, order_row."createdAt"
      FROM "inbound_orders" AS order_row
      WHERE 1=1
      ${statusClause(status)}
      ${barcodeClause("inbound_order_items", barcode)}
    `);
  }
  if (kind === "all" || kind === "outbound") {
    selects.push(Prisma.sql`
      SELECT order_row.id, 'outbound'::text AS kind, order_row."createdAt"
      FROM "outbound_orders" AS order_row
      WHERE 1=1
      ${statusClause(status)}
      ${barcodeClause("outbound_order_items", barcode)}
    `);
  }
  if (kind === "all" || kind === "sales_return") {
    selects.push(Prisma.sql`
      SELECT order_row.id, 'sales_return'::text AS kind, order_row."createdAt"
      FROM "sales_return_orders" AS order_row
      WHERE 1=1
      ${statusClause(status)}
      ${barcodeClause("sales_return_order_items", barcode)}
    `);
  }
  return Prisma.join(selects, " UNION ALL ");
}

function statusClause(status: OrderStatusFilter) {
  if (status === "all") return Prisma.sql``;
  const dbStatus = status === "voided" ? "VOIDED" : "ACTIVE";
  return Prisma.sql`AND order_row.status = ${dbStatus}::"OrderStatus"`;
}

function barcodeClause(table: "inbound_order_items" | "outbound_order_items" | "sales_return_order_items", barcode: string) {
  if (!barcode) return Prisma.sql``;
  const tableSql = Prisma.raw(`"${table}"`);
  return Prisma.sql`
    AND EXISTS (
      SELECT 1
      FROM ${tableSql} AS order_item
      LEFT JOIN "inventory_items" AS current_item ON current_item.id = order_item."inventoryItemId"
      WHERE order_item."orderId" = order_row.id
        AND (
          order_item.barcode = ${barcode}
          OR current_item.barcode = ${barcode}
          OR EXISTS (
            SELECT 1
            FROM "barcode_corrections" AS correction
            WHERE correction."itemId" = order_item."inventoryItemId"
              AND correction."oldBarcode" = ${barcode}
          )
        )
    )
  `;
}

function voidFields(order: {
  status: "ACTIVE" | "VOIDED";
  reversalSupported: boolean;
  voidedAt: Date | null;
  voidedByName: string | null;
  voidReason: string | null;
}) {
  return {
    status: order.status === "VOIDED" ? ("voided" as const) : ("active" as const),
    reversalSupported: order.reversalSupported,
    voidedAt: order.voidedAt ? formatDateTime(order.voidedAt) : undefined,
    voidedBy: order.voidedByName ?? undefined,
    voidReason: order.voidReason ?? undefined
  };
}

function uniqueReferences(input: OrderReference[]) {
  const seen = new Set<string>();
  return input.filter((reference) => {
    if (!reference?.id || !["inbound", "outbound", "sales_return"].includes(reference.kind)) return false;
    const key = `${reference.kind}:${reference.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizePage(value?: number) {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 1;
}

function normalizePageSize(value?: number) {
  if (!Number.isFinite(value) || !value) return 20;
  return Math.min(100, Math.max(1, Math.floor(value)));
}

function normalizeKind(value?: OrderKind | "all") {
  return value === "inbound" || value === "outbound" || value === "sales_return" ? value : "all";
}

function normalizeStatus(value?: OrderStatusFilter): OrderStatusFilter {
  return value === "active" || value === "voided" ? value : "all";
}

function summarizeGoods(names: string[]) {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return Array.from(counts.entries()).map(([name, count]) => `${name} x${count}`).join("、");
}

function summarizeGoodsQuantities(items: Array<{ name: string; quantity: number }>) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + item.quantity);
  return Array.from(counts.entries()).map(([name, count]) => `${name} x${count}`).join("、");
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

function formatOrderKind(kind: OrderKind) {
  if (kind === "inbound") return "入库单";
  if (kind === "outbound") return "出库单";
  return "历史退回单";
}

function formatDateTime(date: Date) {
  return formatAppDateTime(date);
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
