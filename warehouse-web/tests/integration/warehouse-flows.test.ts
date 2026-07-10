import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, test } from "node:test";

import { getPrisma } from "@/lib/db";
import { correctBarcode, writeOffBarcode } from "@/lib/services/barcode-management-service";
import { submitInbound } from "@/lib/services/inbound-service";
import { getInventoryDetail, listInventory } from "@/lib/services/inventory-query-service";
import { listOrderSummaries } from "@/lib/services/order-service";
import { voidOrders } from "@/lib/services/order-reversal-service";
import { submitOutbound } from "@/lib/services/outbound-service";
import { submitSalesReturn } from "@/lib/services/sales-return-service";
import { adjustStockManually } from "@/lib/services/stock-adjustment-service";
import type { CurrentUser } from "@/lib/types";

const prisma = getPrisma();
const operatorName = "集成测试管理员";
const currentUser: CurrentUser = {
  id: "11000000-0000-0000-0000-000000000099",
  username: "integration_admin",
  displayName: operatorName,
  roles: [{ code: "SUPER_ADMIN", name: "超级管理员" }]
};

type Context = Awaited<ReturnType<typeof seedContext>>;
let context: Context;

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "users", "roles", "goods", "warehouses", "salespeople", "terminal_stores"
    RESTART IDENTITY CASCADE
  `);
  context = await seedContext();
});

after(async () => {
  await prisma.$disconnect();
});

test("数量库存和条码追踪核心流程保持一致", async () => {
  await factoryInbound(100);
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 100);
  assert.equal(await prisma.inventoryItem.count(), 0, "厂家到货不应创建条码档案");

  const salesBarcodes = makeBarcodes("SALES", 10);
  await submitOutbound({
    type: "direct",
    sourceWarehouseId: context.sourceWarehouseId,
    salespersonId: context.salespersonId,
    goodsId: context.goodsId,
    barcodes: salesBarcodes,
    operatorName
  });
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 90);
  assert.equal(
    await prisma.inventoryItem.count({ where: { ownerType: "SALESPERSON", status: "WITH_SALESPERSON" } }),
    10
  );

  await submitSalesReturn({
    returnWarehouseId: context.sourceWarehouseId,
    returnLocationId: context.sourceLocationId,
    barcodes: salesBarcodes.slice(0, 2),
    operatorName
  });
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 92);

  const transferBarcodes = makeBarcodes("TRANSFER", 3);
  await submitOutbound({
    type: "direct",
    sourceWarehouseId: context.sourceWarehouseId,
    targetWarehouseId: context.targetWarehouseId,
    targetLocationId: context.targetLocationId,
    goodsId: context.goodsId,
    barcodes: transferBarcodes,
    operatorName
  });
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 89);
  assert.equal(await stockQuantity(context.targetWarehouseId, context.goodsId), 3);

  await submitInbound({
    source: "terminal_return",
    warehouseId: context.sourceWarehouseId,
    locationId: context.sourceLocationId,
    goodsId: context.goodsId,
    terminalStoreId: context.storeId,
    productionDate: "2026-01-10",
    quantity: 2,
    barcodes: ["TERMINAL-NEW-001", salesBarcodes[2]],
    operatorName
  });
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 91);
  await assert.rejects(
    submitInbound({
      source: "terminal_return",
      warehouseId: context.sourceWarehouseId,
      locationId: context.sourceLocationId,
      goodsId: context.goodsId,
      terminalStoreId: context.storeId,
      productionDate: "2026-01-10",
      quantity: 1,
      barcodes: ["TERMINAL-NEW-001"],
      operatorName
    }),
    /不能作为终端店铺退换货重复入库/
  );

  const corrected = await correctBarcode({
    barcode: "TERMINAL-NEW-001",
    newBarcode: "TERMINAL-CORRECTED-001",
    reason: "测试条码录入更正",
    operatorName
  });
  assert.equal(corrected.barcode, "TERMINAL-CORRECTED-001");
  const oldBarcodeDetail = await getInventoryDetail("TERMINAL-NEW-001");
  assert.equal(oldBarcodeDetail.item.barcode, "TERMINAL-CORRECTED-001");
  assert.equal(oldBarcodeDetail.corrections.length, 1);

  await writeOffBarcode({ barcode: "TERMINAL-CORRECTED-001", reason: "测试破损核销", operatorName });
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 90);
  await adjustStockManually({
    warehouseId: context.sourceWarehouseId,
    goodsId: context.goodsId,
    quantityChange: 5,
    reason: "测试盘差修正",
    operatorName
  });
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 95);
});

test("撤销出库恢复数量和归属，存在后续流转时整单拒绝", async () => {
  await factoryInbound(100);
  const barcodes = makeBarcodes("VOID", 10);
  const outbound = await submitOutbound({
    type: "direct",
    sourceWarehouseId: context.sourceWarehouseId,
    salespersonId: context.salespersonId,
    goodsId: context.goodsId,
    barcodes,
    operatorName
  });
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 90);

  await voidOrders({
    orders: [{ id: outbound.orderId, kind: "outbound" }],
    reason: "测试撤销错误出库",
    user: currentUser
  });
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 100);
  assert.equal(await prisma.inventoryItem.count({ where: { barcode: { in: barcodes }, status: "VOIDED" } }), 10);

  const laterBarcode = "VOID-LATER-001";
  const laterOutbound = await submitOutbound({
    type: "direct",
    sourceWarehouseId: context.sourceWarehouseId,
    salespersonId: context.salespersonId,
    goodsId: context.goodsId,
    barcodes: [laterBarcode],
    operatorName
  });
  await submitSalesReturn({
    returnWarehouseId: context.sourceWarehouseId,
    returnLocationId: context.sourceLocationId,
    barcodes: [laterBarcode],
    operatorName
  });
  await assert.rejects(
    voidOrders({
      orders: [{ id: laterOutbound.orderId, kind: "outbound" }],
      reason: "测试存在后续流转",
      user: currentUser
    }),
    /VOID-LATER-001.*已有新的流转/
  );
});

test("并发出库不会让库存小于零", async () => {
  await factoryInbound(1);
  const results = await Promise.allSettled([
    submitOutbound({
      type: "direct",
      sourceWarehouseId: context.sourceWarehouseId,
      salespersonId: context.salespersonId,
      goodsId: context.goodsId,
      barcodes: ["RACE-A"],
      operatorName
    }),
    submitOutbound({
      type: "direct",
      sourceWarehouseId: context.sourceWarehouseId,
      salespersonId: context.salespersonId,
      goodsId: context.goodsId,
      barcodes: ["RACE-B"],
      operatorName
    })
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 0);
});

test("500 条批量出库与精确查询达到本地性能门槛", async () => {
  await factoryInbound(500);
  const barcodes = makeBarcodes("BATCH", 500);
  const startedAt = performance.now();
  await submitOutbound({
    type: "direct",
    sourceWarehouseId: context.sourceWarehouseId,
    salespersonId: context.salespersonId,
    goodsId: context.goodsId,
    barcodes,
    operatorName
  });
  const elapsed = performance.now() - startedAt;
  assert.ok(elapsed < 5_000, `500 条批量出库耗时 ${Math.round(elapsed)}ms，超过 5 秒门槛`);

  const queryStartedAt = performance.now();
  const inventory = await listInventory({ keyword: barcodes[250], page: 1, pageSize: 20 });
  const orders = await listOrderSummaries({ barcode: barcodes[250], page: 1, pageSize: 20 });
  const queryElapsed = performance.now() - queryStartedAt;
  assert.equal(inventory.total, 1);
  assert.equal(orders.total, 1);
  assert.ok(queryElapsed < 500, `条码和单据精确查询耗时 ${Math.round(queryElapsed)}ms，超过 500ms 门槛`);
});

async function factoryInbound(quantity: number) {
  return submitInbound({
    source: "factory",
    warehouseId: context.sourceWarehouseId,
    locationId: context.sourceLocationId,
    goodsId: context.goodsId,
    quantity,
    operatorName
  });
}

async function stockQuantity(warehouseId: string, goodsId: string) {
  const stock = await prisma.warehouseStock.findUnique({
    where: { warehouseId_goodsId: { warehouseId, goodsId } }
  });
  return stock?.quantity ?? 0;
}

function makeBarcodes(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(4, "0")}`);
}

async function seedContext() {
  const goodsId = randomUUID();
  const sourceWarehouseId = randomUUID();
  const sourceLocationId = randomUUID();
  const targetWarehouseId = randomUUID();
  const targetLocationId = randomUUID();
  const salespersonId = randomUUID();
  const storeId = randomUUID();
  await prisma.goods.create({
    data: { id: goodsId, code: "TEST-GOODS", name: "集成测试货物", category: "HEALTH_WINE", unit: "瓶", spec: "500ml" }
  });
  await prisma.warehouse.create({
    data: {
      id: sourceWarehouseId,
      code: "TEST-WH-A",
      name: "测试仓库 A",
      manager: "测试员",
      locations: { create: { id: sourceLocationId, zone: "默认", code: "DEFAULT", name: "默认库位" } }
    }
  });
  await prisma.warehouse.create({
    data: {
      id: targetWarehouseId,
      code: "TEST-WH-B",
      name: "测试仓库 B",
      manager: "测试员",
      locations: { create: { id: targetLocationId, zone: "默认", code: "DEFAULT", name: "默认库位" } }
    }
  });
  await prisma.salesperson.create({
    data: { id: salespersonId, code: "TEST-SP", name: "测试销售", phone: "13800000000", region: "测试区域" }
  });
  await prisma.terminalStore.create({
    data: { id: storeId, name: "测试终端店", contact: "测试店长", phone: "13700000000", address: "测试地址" }
  });
  return { goodsId, sourceWarehouseId, sourceLocationId, targetWarehouseId, targetLocationId, salespersonId, storeId };
}
