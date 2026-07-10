import { getPrisma } from "@/lib/db";
import type { ConsistencyAuditIssue, ConsistencyAuditResult } from "@/lib/types";

const detailLimit = 500;

type CountRow = {
  code: string;
  severity: ConsistencyAuditIssue["severity"];
  count: number;
};

type IssueRow = {
  code: string;
  severity: ConsistencyAuditIssue["severity"];
  entityType: string;
  entityId: string;
  summary: string;
  suggestion: string;
};

const auditCtes = `
WITH latest_stock_movements AS (
  SELECT DISTINCT ON ("warehouseId", "goodsId")
    id, "warehouseId", "goodsId", "balanceAfter", "occurredAt"
  FROM warehouse_stock_movements
  ORDER BY "warehouseId", "goodsId", "occurredAt" DESC, id DESC
),
ordered_stock_movements AS (
  SELECT
    id,
    "warehouseId",
    "goodsId",
    "quantityChange",
    "balanceAfter",
    LAG("balanceAfter") OVER (
      PARTITION BY "warehouseId", "goodsId"
      ORDER BY "occurredAt", id
    ) AS previous_balance
  FROM warehouse_stock_movements
),
latest_barcode_movements AS (
  SELECT DISTINCT ON ("itemId")
    id, "itemId", barcode, type, "occurredAt"
  FROM stock_movements
  ORDER BY "itemId", "occurredAt" DESC, id DESC
),
voided_orders AS (
  SELECT id, "orderNo", 'inbound'::text AS kind FROM inbound_orders WHERE status = 'VOIDED'
  UNION ALL
  SELECT id, "orderNo", 'outbound'::text AS kind FROM outbound_orders WHERE status = 'VOIDED'
  UNION ALL
  SELECT id, "orderNo", 'sales_return'::text AS kind FROM sales_return_orders WHERE status = 'VOIDED'
),
issues AS (
  SELECT
    'STOCK_MISSING_BASELINE'::text AS code,
    'info'::text AS severity,
    'warehouse_stock'::text AS "entityType",
    ws.id::text AS "entityId",
    CONCAT(w.name, ' / ', g.name, ' 当前库存 ', ws.quantity, ' 件，但没有历史数量流水基线') AS summary,
    '这是旧数据迁移后的提示；发生下一次库存业务后将建立可核对余额。'::text AS suggestion
  FROM warehouse_stocks ws
  JOIN warehouses w ON w.id = ws."warehouseId"
  JOIN goods g ON g.id = ws."goodsId"
  LEFT JOIN latest_stock_movements latest
    ON latest."warehouseId" = ws."warehouseId" AND latest."goodsId" = ws."goodsId"
  WHERE latest.id IS NULL

  UNION ALL

  SELECT
    'STOCK_BALANCE_MISMATCH',
    'error',
    'warehouse_stock',
    ws.id::text,
    CONCAT(w.name, ' / ', g.name, ' 当前库存 ', ws.quantity, ' 件，最后流水余额为 ', latest."balanceAfter", ' 件'),
    '先核对最近单据与数量流水，再由超级管理员执行有原因的库存修正。'
  FROM warehouse_stocks ws
  JOIN warehouses w ON w.id = ws."warehouseId"
  JOIN goods g ON g.id = ws."goodsId"
  JOIN latest_stock_movements latest
    ON latest."warehouseId" = ws."warehouseId" AND latest."goodsId" = ws."goodsId"
  WHERE ws.quantity <> latest."balanceAfter"

  UNION ALL

  SELECT
    'STOCK_MOVEMENT_INVALID',
    'error',
    'warehouse_stock_movement',
    movement.id::text,
    CONCAT('数量流水存在异常：变动 ', movement."quantityChange", '，流水后余额 ', movement."balanceAfter"),
    '核对关联单据；不要直接修改流水，必要时通过人工库存修正留下新记录。'
  FROM warehouse_stock_movements movement
  WHERE movement."quantityChange" = 0 OR movement."balanceAfter" < 0

  UNION ALL

  SELECT
    'STOCK_MOVEMENT_CHAIN_BROKEN',
    'error',
    'warehouse_stock_movement',
    movement.id::text,
    CONCAT('数量流水不连续：前次余额 ', movement.previous_balance, ' + 本次变动 ', movement."quantityChange", ' 不等于 ', movement."balanceAfter"),
    '核对同一仓库货物的并发操作和历史数据，再通过库存修正恢复当前余额。'
  FROM ordered_stock_movements movement
  WHERE movement.previous_balance IS NOT NULL
    AND movement.previous_balance + movement."quantityChange" <> movement."balanceAfter"

  UNION ALL

  SELECT
    'BARCODE_OWNER_STATUS_MISMATCH',
    'error',
    'inventory_item',
    item.id::text,
    CONCAT('条码 ', item.barcode, ' 的状态与当前归属不一致'),
    '查看条码详情和最后流转；根据真实货物状态执行撤销、退回或核销。'
  FROM inventory_items item
  WHERE (item.status = 'IN_STOCK' AND item."ownerType" <> 'WAREHOUSE')
     OR (item.status = 'WITH_SALESPERSON' AND item."ownerType" <> 'SALESPERSON')

  UNION ALL

  SELECT
    'BARCODE_LOCATION_MISMATCH',
    'error',
    'inventory_item',
    item.id::text,
    CONCAT('条码 ', item.barcode, ' 的库位不属于当前仓库'),
    '核对条码最后一次挪仓或退回记录，并更正条码归属。'
  FROM inventory_items item
  JOIN storage_locations location ON location.id = item."locationId"
  WHERE item."ownerType" = 'WAREHOUSE' AND location."warehouseId" <> item."warehouseId"

  UNION ALL

  SELECT
    'BARCODE_LAST_MOVEMENT_MISMATCH',
    'error',
    'inventory_item',
    item.id::text,
    CONCAT('条码 ', item.barcode, ' 的当前档案时间或编号与最后流转不一致'),
    '查看条码更正历史和最后流转，确认是否存在未完整提交的业务。'
  FROM inventory_items item
  JOIN latest_barcode_movements latest ON latest."itemId" = item.id
  WHERE item."lastMovedAt" <> latest."occurredAt" OR item.barcode <> latest.barcode

  UNION ALL

  SELECT
    'BARCODE_LAST_STATE_MISMATCH',
    'error',
    'inventory_item',
    item.id::text,
    CONCAT('条码 ', item.barcode, ' 的当前状态与最后业务类型 ', latest.type::text, ' 不一致'),
    '核对最后业务单据；存在错误单据时优先撤销，不要直接删除历史。'
  FROM inventory_items item
  JOIN latest_barcode_movements latest ON latest."itemId" = item.id
  WHERE (latest.type = 'SALES_OUTBOUND' AND (item."ownerType" <> 'SALESPERSON' OR item.status <> 'WITH_SALESPERSON'))
     OR (latest.type IN ('TERMINAL_RETURN_INBOUND', 'TRANSFER', 'SALES_RETURN') AND (item."ownerType" <> 'WAREHOUSE' OR item.status <> 'IN_STOCK'))
     OR (latest.type = 'WRITE_OFF' AND item.status <> 'WRITTEN_OFF')

  UNION ALL

  SELECT
    'ORPHAN_ORDER_MOVEMENT',
    'error',
    'stock_movement',
    movement.id::text,
    CONCAT('条码流水 ', movement.id::text, ' 引用了不存在的业务单据'),
    '检查数据库迁移或异常删除记录；保留流水并恢复缺失单据引用。'
  FROM stock_movements movement
  WHERE movement."orderId" IS NOT NULL AND (
    movement."orderKind" IS NULL
    OR movement."orderKind" NOT IN ('inbound', 'outbound', 'sales_return')
    OR (movement."orderKind" = 'inbound' AND NOT EXISTS (SELECT 1 FROM inbound_orders o WHERE o.id = movement."orderId"))
    OR (movement."orderKind" = 'outbound' AND NOT EXISTS (SELECT 1 FROM outbound_orders o WHERE o.id = movement."orderId"))
    OR (movement."orderKind" = 'sales_return' AND NOT EXISTS (SELECT 1 FROM sales_return_orders o WHERE o.id = movement."orderId"))
  )

  UNION ALL

  SELECT
    'ORPHAN_ORDER_MOVEMENT',
    'error',
    'warehouse_stock_movement',
    movement.id::text,
    CONCAT('数量流水 ', movement.id::text, ' 引用了不存在的业务单据'),
    '检查数据库迁移或异常删除记录；保留流水并恢复缺失单据引用。'
  FROM warehouse_stock_movements movement
  WHERE movement."orderId" IS NOT NULL AND (
    movement."orderKind" IS NULL
    OR movement."orderKind" NOT IN ('inbound', 'outbound', 'sales_return')
    OR (movement."orderKind" = 'inbound' AND NOT EXISTS (SELECT 1 FROM inbound_orders o WHERE o.id = movement."orderId"))
    OR (movement."orderKind" = 'outbound' AND NOT EXISTS (SELECT 1 FROM outbound_orders o WHERE o.id = movement."orderId"))
    OR (movement."orderKind" = 'sales_return' AND NOT EXISTS (SELECT 1 FROM sales_return_orders o WHERE o.id = movement."orderId"))
  )

  UNION ALL

  SELECT
    'VOIDED_ORDER_WITHOUT_REVERSAL',
    'error',
    CONCAT(voided.kind, '_order'),
    voided.id::text,
    CONCAT('已作废单据 ', voided."orderNo", ' 没有对应撤销流水'),
    '核对单据撤销是否完整；不要再次删除单据或手工补写库存。'
  FROM voided_orders voided
  WHERE NOT EXISTS (
    SELECT 1 FROM stock_movements movement
    WHERE movement."orderKind" = voided.kind AND movement."orderId" = voided.id AND movement.type = 'ORDER_REVERSAL'
  )
  AND NOT EXISTS (
    SELECT 1 FROM warehouse_stock_movements movement
    WHERE movement."orderKind" = voided.kind AND movement."orderId" = voided.id AND movement.type = 'ORDER_REVERSAL'
  )
)
`;

export async function runConsistencyAudit(): Promise<ConsistencyAuditResult> {
  const prisma = getPrisma();
  const [countRows, issueRows] = await Promise.all([
    prisma.$queryRawUnsafe<CountRow[]>(`${auditCtes}
      SELECT code, severity, COUNT(*)::integer AS count
      FROM issues
      GROUP BY code, severity
      ORDER BY code
    `),
    prisma.$queryRawUnsafe<IssueRow[]>(`${auditCtes}
      SELECT code, severity, "entityType", "entityId", summary, suggestion
      FROM issues
      ORDER BY CASE severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, code, "entityId"
      LIMIT ${detailLimit}
    `)
  ]);

  const severityCounts = { error: 0, warning: 0, info: 0 };
  const categoryCounts: Record<string, number> = {};
  for (const row of countRows) {
    severityCounts[row.severity] += Number(row.count);
    categoryCounts[row.code] = Number(row.count);
  }
  const total = severityCounts.error + severityCounts.warning + severityCounts.info;

  return {
    generatedAt: new Date().toISOString(),
    healthy: severityCounts.error === 0,
    total,
    truncated: total > detailLimit,
    severityCounts,
    categoryCounts,
    issues: issueRows
  };
}
