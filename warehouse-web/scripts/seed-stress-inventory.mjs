import "dotenv/config";

import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;

const inventoryCount = readPositiveIntegerArg("--count", 5000);
const batchSize = readPositiveIntegerArg("--batch-size", 500);
const transferCount = Math.min(readPositiveIntegerArg("--transfer", 1000), inventoryCount);
const salesOutboundCount = Math.min(readPositiveIntegerArg("--sales-outbound", 1000), inventoryCount - transferCount);
const salesReturnCount = Math.min(readPositiveIntegerArg("--sales-return", 300), salesOutboundCount);
const terminalReturnCount = Math.min(
  readPositiveIntegerArg("--terminal-return", 200),
  Math.max(0, salesOutboundCount - salesReturnCount)
);
const prefix = readStringArg("--prefix", `STRESS${timestampText()}`);

if (!process.env.DATABASE_URL) {
  console.error("缺少 DATABASE_URL，无法连接数据库。");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  await client.query("BEGIN");

  const context = await createStressMasterData(prefix);
  const now = new Date();
  const records = Array.from({ length: inventoryCount }, (_, index) => ({
    itemId: randomUUID(),
    factoryMovementId: randomUUID(),
    factoryOrderItemId: randomUUID(),
    barcode: `${prefix}${String(index + 1).padStart(6, "0")}`,
    goods: context.goods[index % context.goods.length]
  }));

  await createFactoryInbound(records, context, now);
  await createTransfer(records.slice(0, transferCount), context, addMinutes(now, 3));

  const salesRecords = records.slice(transferCount, transferCount + salesOutboundCount);
  await createSalesOutbound(salesRecords, context, addMinutes(now, 6));
  await createSalesReturn(salesRecords.slice(0, salesReturnCount), context, addMinutes(now, 9));
  await createTerminalReturnInbound(
    salesRecords.slice(salesReturnCount, salesReturnCount + terminalReturnCount),
    context,
    addMinutes(now, 12)
  );

  await client.query("COMMIT");
  console.log("压测数据写入完成：");
  console.log(`- 新增货物：${context.goods.length} 个`);
  console.log(`- 新增分仓：${context.branches.length} 个`);
  console.log(`- 新增销售人员：${context.salespeople.length} 个`);
  console.log(`- 新增终端店铺：${context.stores.length} 个`);
  console.log(`- 厂家到货入库：${records.length} 件`);
  console.log(`- 挪仓：${transferCount} 件`);
  console.log(`- 销售出库：${salesOutboundCount} 件`);
  console.log(`- 销售退回：${salesReturnCount} 件`);
  console.log(`- 终端退换货入库：${terminalReturnCount} 件`);
  console.log(`- 条码前缀：${prefix}`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

async function createStressMasterData(runPrefix) {
  const base = await loadBaseContext();
  const now = new Date();

  const goods = Array.from({ length: 20 }, (_, index) => ({
    id: randomUUID(),
    code: `${runPrefix}-G${String(index + 1).padStart(2, "0")}`,
    name: `压测货物${String(index + 1).padStart(2, "0")}`,
    category: index % 2 === 0 ? "HEALTH_WINE" : "BAIJIU",
    unit: "瓶",
    spec: index % 2 === 0 ? "500ml/瓶" : "52度 500ml/瓶"
  }));

  const branches = Array.from({ length: 3 }, (_, index) => ({
    id: randomUUID(),
    locationId: randomUUID(),
    code: `${runPrefix}-WH${String(index + 1).padStart(2, "0")}`,
    name: `压测分仓${String(index + 1).padStart(2, "0")}`,
    manager: `压测库管${index + 1}`,
    locationCode: "DEFAULT",
    locationName: "默认库位"
  }));

  const salespeople = Array.from({ length: 6 }, (_, index) => ({
    id: randomUUID(),
    code: `${runPrefix}-SP${String(index + 1).padStart(2, "0")}`,
    name: `压测销售${String(index + 1).padStart(2, "0")}`,
    phone: `139${String(index + 1).padStart(8, "0")}`,
    region: `压测区域${index + 1}`
  }));

  const stores = Array.from({ length: 6 }, (_, index) => ({
    id: randomUUID(),
    name: `压测终端店${String(index + 1).padStart(2, "0")}`,
    contact: `压测店长${index + 1}`,
    phone: `138${String(index + 1).padStart(8, "0")}`,
    address: `压测地址 ${index + 1} 号`
  }));

  await bulkInsert(
    "goods",
    ["id", "code", "name", "category", "unit", "spec", "createdAt", "updatedAt"],
    goods.map((item) => [item.id, item.code, item.name, item.category, item.unit, item.spec, now, now])
  );

  await bulkInsert(
    "warehouses",
    ["id", "code", "name", "type", "parentId", "manager", "createdAt", "updatedAt"],
    branches.map((item) => [item.id, item.code, item.name, "BRANCH", base.mainWarehouseId, item.manager, now, now])
  );

  await bulkInsert(
    "storage_locations",
    ["id", "warehouseId", "zone", "code", "name", "createdAt", "updatedAt"],
    branches.map((item) => [
      item.locationId,
      item.id,
      "默认",
      item.locationCode,
      item.locationName,
      now,
      now
    ])
  );

  await bulkInsert(
    "salespeople",
    ["id", "code", "name", "phone", "region", "createdAt", "updatedAt"],
    salespeople.map((item) => [item.id, item.code, item.name, item.phone, item.region, now, now])
  );

  await bulkInsert(
    "terminal_stores",
    ["id", "name", "contact", "phone", "address", "createdAt", "updatedAt"],
    stores.map((item) => [item.id, item.name, item.contact, item.phone, item.address, now, now])
  );

  return { ...base, goods, branches, salespeople, stores };
}

async function loadBaseContext() {
  const result = await client.query(`
    SELECT
      warehouses.id AS "mainWarehouseId",
      warehouses.name AS "mainWarehouseName",
      storage_locations.id AS "mainLocationId",
      storage_locations.name AS "mainLocationName",
      users.id AS "operatorId",
      users."displayName" AS "operatorName"
    FROM warehouses
    JOIN storage_locations ON storage_locations."warehouseId" = warehouses.id
    LEFT JOIN users ON users.username = 'super_admin'
    WHERE warehouses.status = 'ENABLED'
      AND warehouses.type = 'MAIN'
      AND storage_locations.status = 'ENABLED'
    ORDER BY storage_locations.code ASC
    LIMIT 1
  `);

  const row = result.rows[0];
  if (!row) {
    throw new Error("缺少启用的总仓或默认库位。请先初始化基础资料。");
  }

  return {
    mainWarehouseId: row.mainWarehouseId,
    mainWarehouseName: row.mainWarehouseName,
    mainLocationId: row.mainLocationId,
    mainLocationName: row.mainLocationName,
    operatorId: row.operatorId ?? null,
    operatorName: row.operatorName ?? "压测脚本"
  };
}

async function createFactoryInbound(records, context, occurredAt) {
  const orderId = randomUUID();
  const destinationLabel = mainWarehouseLabel(context);

  await insertInboundOrder({
    id: orderId,
    orderNo: `RK${timestampText()}STRESS`,
    source: "FACTORY",
    warehouseId: context.mainWarehouseId,
    locationId: context.mainLocationId,
    terminalStoreId: null,
    context,
    occurredAt
  });

  for (const batch of chunks(records, batchSize)) {
    await bulkInsert(
      "inventory_items",
      [
        "id",
        "barcode",
        "goodsId",
        "ownerType",
        "warehouseId",
        "locationId",
        "status",
        "inboundSource",
        "lastMovedAt",
        "createdAt",
        "updatedAt"
      ],
      batch.map((record) => [
        record.itemId,
        record.barcode,
        record.goods.id,
        "WAREHOUSE",
        context.mainWarehouseId,
        context.mainLocationId,
        "IN_STOCK",
        "FACTORY",
        occurredAt,
        occurredAt,
        occurredAt
      ])
    );
    await insertInboundItems(batch, orderId);
    await insertMovements(
      batch.map((record) => ({
        id: record.factoryMovementId,
        itemId: record.itemId,
        barcode: record.barcode,
        goodsId: record.goods.id,
        type: "FACTORY_INBOUND",
        fromLabel: "压测数据生成",
        toLabel: destinationLabel,
        note: "压测数据：厂家到货入库"
      })),
      context,
      occurredAt
    );
  }
}

async function createTransfer(records, context, occurredAt) {
  if (records.length === 0) return;

  const branch = context.branches[0];
  const orderId = randomUUID();
  await insertOutboundOrder({
    id: orderId,
    orderNo: `CK${timestampText()}TR`,
    type: "TRANSFER",
    sourceWarehouseId: context.mainWarehouseId,
    targetWarehouseId: branch.id,
    targetLocationId: branch.locationId,
    salespersonId: null,
    context,
    occurredAt
  });

  for (const batch of chunks(records, batchSize)) {
    await updateItemsToWarehouse(batch, branch.id, branch.locationId, occurredAt);
    await insertOutboundItems(batch, orderId);
    await insertMovements(
      batch.map((record) => ({
        id: randomUUID(),
        itemId: record.itemId,
        barcode: record.barcode,
        goodsId: record.goods.id,
        type: "TRANSFER",
        fromLabel: mainWarehouseLabel(context),
        toLabel: `${branch.name} / ${branch.locationName}`,
        note: "压测数据：挪仓"
      })),
      context,
      occurredAt
    );
  }
}

async function createSalesOutbound(records, context, occurredAt) {
  if (records.length === 0) return;

  const salesperson = context.salespeople[0];
  const orderId = randomUUID();
  await insertOutboundOrder({
    id: orderId,
    orderNo: `CK${timestampText()}XS`,
    type: "SALES",
    sourceWarehouseId: context.mainWarehouseId,
    targetWarehouseId: null,
    targetLocationId: null,
    salespersonId: salesperson.id,
    context,
    occurredAt
  });

  for (const batch of chunks(records, batchSize)) {
    await updateItemsToSalesperson(batch, salesperson.id, occurredAt);
    await insertOutboundItems(batch, orderId);
    await insertMovements(
      batch.map((record) => ({
        id: randomUUID(),
        itemId: record.itemId,
        barcode: record.barcode,
        goodsId: record.goods.id,
        type: "SALES_OUTBOUND",
        fromLabel: mainWarehouseLabel(context),
        toLabel: `销售人员：${salesperson.name}`,
        note: "压测数据：销售出库"
      })),
      context,
      occurredAt
    );
  }
}

async function createSalesReturn(records, context, occurredAt) {
  if (records.length === 0) return;

  const salesperson = context.salespeople[0];
  const orderId = randomUUID();
  await client.query(
    `
      INSERT INTO sales_return_orders (
        id, "orderNo", "returnWarehouseId", "returnLocationId", "operatorId", "operatorName", "createdAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      orderId,
      `XT${timestampText()}SR`,
      context.mainWarehouseId,
      context.mainLocationId,
      context.operatorId,
      context.operatorName,
      occurredAt
    ]
  );

  for (const batch of chunks(records, batchSize)) {
    await updateItemsToWarehouse(batch, context.mainWarehouseId, context.mainLocationId, occurredAt);
    await bulkInsert(
      "sales_return_order_items",
      ["id", "orderId", "inventoryItemId", "barcode", "goodsId", "fromSalespersonId"],
      batch.map((record) => [randomUUID(), orderId, record.itemId, record.barcode, record.goods.id, salesperson.id])
    );
    await insertMovements(
      batch.map((record) => ({
        id: randomUUID(),
        itemId: record.itemId,
        barcode: record.barcode,
        goodsId: record.goods.id,
        type: "SALES_RETURN",
        fromLabel: `销售人员：${salesperson.name}`,
        toLabel: mainWarehouseLabel(context),
        note: "压测数据：销售退回"
      })),
      context,
      occurredAt
    );
  }
}

async function createTerminalReturnInbound(records, context, occurredAt) {
  if (records.length === 0) return;

  const store = context.stores[0];
  const orderId = randomUUID();
  const productionDate = "2026-01-01";
  const shelfLifeDate = "2029-01-01";

  await insertInboundOrder({
    id: orderId,
    orderNo: `RK${timestampText()}TH`,
    source: "TERMINAL_RETURN",
    warehouseId: context.mainWarehouseId,
    locationId: context.mainLocationId,
    terminalStoreId: store.id,
    context,
    occurredAt
  });

  for (const batch of chunks(records, batchSize)) {
    await updateItemsToWarehouse(batch, context.mainWarehouseId, context.mainLocationId, occurredAt, {
      inboundSource: "TERMINAL_RETURN",
      productionDate,
      shelfLifeDate
    });
    await insertInboundItems(batch, orderId, { productionDate, shelfLifeDate });
    await insertMovements(
      batch.map((record) => ({
        id: randomUUID(),
        itemId: record.itemId,
        barcode: record.barcode,
        goodsId: record.goods.id,
        type: "TERMINAL_RETURN_INBOUND",
        fromLabel: store.name,
        toLabel: mainWarehouseLabel(context),
        note: `压测数据：终端退换货入库，生产日期 ${productionDate}`
      })),
      context,
      occurredAt
    );
  }
}

async function insertInboundOrder({ id, orderNo, source, warehouseId, locationId, terminalStoreId, context, occurredAt }) {
  await client.query(
    `
      INSERT INTO inbound_orders (
        id, "orderNo", source, "warehouseId", "locationId", "terminalStoreId", "operatorId", "operatorName", "createdAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [id, orderNo, source, warehouseId, locationId, terminalStoreId, context.operatorId, context.operatorName, occurredAt]
  );
}

async function insertOutboundOrder({
  id,
  orderNo,
  type,
  sourceWarehouseId,
  targetWarehouseId,
  targetLocationId,
  salespersonId,
  context,
  occurredAt
}) {
  await client.query(
    `
      INSERT INTO outbound_orders (
        id, "orderNo", type, "sourceWarehouseId", "targetWarehouseId", "targetLocationId",
        "salespersonId", "operatorId", "operatorName", "createdAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      id,
      orderNo,
      type,
      sourceWarehouseId,
      targetWarehouseId,
      targetLocationId,
      salespersonId,
      context.operatorId,
      context.operatorName,
      occurredAt
    ]
  );
}

async function insertInboundItems(records, orderId, dates = {}) {
  await bulkInsert(
    "inbound_order_items",
    ["id", "orderId", "inventoryItemId", "barcode", "goodsId", "productionDate", "shelfLifeDate"],
    records.map((record) => [
      randomUUID(),
      orderId,
      record.itemId,
      record.barcode,
      record.goods.id,
      dates.productionDate ?? null,
      dates.shelfLifeDate ?? null
    ])
  );
}

async function insertOutboundItems(records, orderId) {
  await bulkInsert(
    "outbound_order_items",
    ["id", "orderId", "inventoryItemId", "barcode", "goodsId"],
    records.map((record) => [randomUUID(), orderId, record.itemId, record.barcode, record.goods.id])
  );
}

async function insertMovements(movements, context, occurredAt) {
  await bulkInsert(
    "stock_movements",
    [
      "id",
      "itemId",
      "barcode",
      "goodsId",
      "type",
      "fromLabel",
      "toLabel",
      "operatorId",
      "operatorName",
      "occurredAt",
      "note"
    ],
    movements.map((movement) => [
      movement.id,
      movement.itemId,
      movement.barcode,
      movement.goodsId,
      movement.type,
      movement.fromLabel,
      movement.toLabel,
      context.operatorId,
      context.operatorName,
      occurredAt,
      movement.note
    ])
  );
}

async function updateItemsToWarehouse(records, warehouseId, locationId, movedAt, extra = {}) {
  await client.query(
    `
      UPDATE inventory_items
      SET
        "ownerType" = 'WAREHOUSE',
        "warehouseId" = $1,
        "locationId" = $2,
        "salespersonId" = NULL,
        status = 'IN_STOCK',
        "inboundSource" = COALESCE($3, "inboundSource"),
        "productionDate" = COALESCE($4::date, "productionDate"),
        "shelfLifeDate" = COALESCE($5::date, "shelfLifeDate"),
        "lastMovedAt" = $6,
        "updatedAt" = $6
      WHERE id = ANY($7::uuid[])
    `,
    [
      warehouseId,
      locationId,
      extra.inboundSource ?? null,
      extra.productionDate ?? null,
      extra.shelfLifeDate ?? null,
      movedAt,
      records.map((record) => record.itemId)
    ]
  );
}

async function updateItemsToSalesperson(records, salespersonId, movedAt) {
  await client.query(
    `
      UPDATE inventory_items
      SET
        "ownerType" = 'SALESPERSON',
        "warehouseId" = NULL,
        "locationId" = NULL,
        "salespersonId" = $1,
        status = 'WITH_SALESPERSON',
        "lastMovedAt" = $2,
        "updatedAt" = $2
      WHERE id = ANY($3::uuid[])
    `,
    [salespersonId, movedAt, records.map((record) => record.itemId)]
  );
}

async function bulkInsert(table, columns, rows) {
  if (rows.length === 0) return;

  const quotedColumns = columns.map((column) => `"${column}"`).join(", ");
  const values = [];
  const placeholders = rows.map((row, rowIndex) => {
    const offset = rowIndex * columns.length;
    values.push(...row);
    return `(${row.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
  });

  await client.query(`INSERT INTO "${table}" (${quotedColumns}) VALUES ${placeholders.join(", ")}`, values);
}

function mainWarehouseLabel(context) {
  return `${context.mainWarehouseName} / ${context.mainLocationName}`;
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function readPositiveIntegerArg(name, fallback) {
  const raw = readStringArg(name, "");
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return parsed;
}

function readStringArg(name, fallback) {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function timestampText() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(
    date.getMinutes()
  )}${pad(date.getSeconds())}`;
}
