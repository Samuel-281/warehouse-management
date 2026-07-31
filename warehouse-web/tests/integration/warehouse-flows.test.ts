import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { after, beforeEach, test } from "node:test";

import ExcelJS from "exceljs";

import { getPrisma } from "@/lib/db";
import { formatOperationAction, formatOperationDetail } from "@/lib/operation-log-labels";
import { correctBarcode, writeOffBarcode } from "@/lib/services/barcode-management-service";
import { runConsistencyAudit } from "@/lib/services/consistency-audit-service";
import { submitInbound } from "@/lib/services/inbound-service";
import { getInventoryDetail, listInventory } from "@/lib/services/inventory-query-service";
import { listOrderSummaries } from "@/lib/services/order-service";
import { voidOrders } from "@/lib/services/order-reversal-service";
import { submitOutbound } from "@/lib/services/outbound-service";
import { submitSalesReturn } from "@/lib/services/sales-return-service";
import { adjustStockManually } from "@/lib/services/stock-adjustment-service";
import {
  getTrackedBarcodeDetail,
  getTrackingOrderDetail,
  getTrackingSummary,
  listTrackingOrders,
  submitTrackingOutbound,
  submitTrackingReturn,
  validateTrackingBarcodes
} from "@/lib/services/tracking-service";
import {
  createTrackingOrderGroup,
  dissolveTrackingOrderGroup,
  getTrackingOrderGroupDetail,
  listTrackingOrderGroups
} from "@/lib/services/tracking-order-group-service";
import {
  importTerminalReceipts,
  previewTerminalReceiptImport
} from "@/lib/services/terminal-receipt-service";
import {
  createTerminalReceiptSyncRun,
  executeTerminalReceiptSync,
  getTerminalReceiptSyncOverview
} from "@/lib/services/terminal-receipt-sync-service";
import {
  claimBrowserConnectorTask,
  completeBrowserConnectorTask
} from "@/lib/services/terminal-receipt-browser-connector-service";
import { downloadQinceTerminalReceipts } from "@/lib/services/qince-terminal-receipt-client";
import { changeOwnPassword, createUser, resetUserPassword, updateUser } from "@/lib/services/user-service";
import { verifyPassword } from "@/lib/password";
import type { CurrentUser } from "@/lib/types";
import { GET as getConsistencyAudit } from "@/app/api/system/consistency-audit/route";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getBackupStatus } from "@/app/api/system/backup-status/route";

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
    TRUNCATE TABLE "terminal_receipt_imports", "users", "roles", "goods", "warehouses", "salespeople", "terminal_stores"
    RESTART IDENTITY CASCADE
  `);
  context = await seedContext();
});

after(async () => {
  await prisma.$disconnect();
});

test("操作日志动作和结构化说明使用中文显示", () => {
  assert.equal(formatOperationAction("INBOUND_CREATE"), "创建入库单");
  assert.equal(formatOperationAction("TERMINAL_RECEIPT_SYNC"), "同步终端签收记录");
  assert.equal(
    formatOperationDetail("quantity=20;barcodes=0;replay=false"),
    "数量：20；条码数量：0；重复请求：否"
  );
  assert.equal(
    formatOperationDetail("trigger=SCHEDULED;range=2026-07-06~2026-07-12;duplicates=2"),
    "触发方式：每周自动同步；同步日期：2026-07-06~2026-07-12；重复记录：2"
  );
  assert.equal(formatOperationDetail("Clear operational data from web maintenance page"), "通过系统维护页面清空业务数据");
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

  const mixedReturn = await submitSalesReturn({
    returnWarehouseId: context.sourceWarehouseId,
    returnLocationId: context.sourceLocationId,
    items: [
      { barcode: "TERMINAL-NEW-001", goodsId: context.goodsId },
      { barcode: salesBarcodes[2] }
    ],
    operatorName
  });
  assert.equal(mixedReturn.pendingCount, 1);
  assert.equal(mixedReturn.signedCount, 0);
  assert.equal(mixedReturn.newTrackingCount, 1);
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 91);
  await assert.rejects(
    submitSalesReturn({
      returnWarehouseId: context.sourceWarehouseId,
      returnLocationId: context.sourceLocationId,
      items: [{ barcode: "TERMINAL-NEW-001", goodsId: context.goodsId }],
      operatorName
    }),
    /已在仓库或处于不可退回状态/
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
  const exactWrittenOff = await listInventory({ keyword: "TERMINAL-CORRECTED-001", page: 1, pageSize: 20 });
  assert.equal(exactWrittenOff.total, 1, "精确条码查询应包含已核销档案");
  assert.equal(exactWrittenOff.items[0]?.status, "written_off");
  const writtenOffInventory = await listInventory({ statusScope: "written_off", page: 1, pageSize: 20 });
  assert.equal(writtenOffInventory.total, 1, "应支持按已核销状态查询条码");
  assert.equal(writtenOffInventory.items[0]?.barcode, "TERMINAL-CORRECTED-001");
  await adjustStockManually({
    warehouseId: context.sourceWarehouseId,
    goodsId: context.goodsId,
    quantityChange: 5,
    reason: "测试盘差修正",
    operatorName
  });
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 95);
});

test("勤策签收更新终端归属，店铺间流转不改变仓库库存", async () => {
  await factoryInbound(100);
  const barcode = "601637081135";
  await submitOutbound({
    type: "direct",
    sourceWarehouseId: context.sourceWarehouseId,
    salespersonId: context.salespersonId,
    goodsId: context.goodsId,
    barcodes: [barcode],
    operatorName
  });
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 99);

  const firstReceiptAt = new Date();
  const buffer = await makeTerminalReceiptWorkbook([
    { barcode, scannedAt: firstReceiptAt, storeName: "测试收货门店 A" },
    { barcode: "601637081136", scannedAt: firstReceiptAt, storeName: "未匹配门店" }
  ]);

  const preview = await previewTerminalReceiptImport("签收明细.xlsx", buffer);
  assert.equal(preview.totalRows, 2);
  assert.equal(preview.matchedRows, 1);
  assert.equal(preview.unmatchedRows, 1);
  assert.equal(preview.conflictRows, 0);
  assert.equal(preview.invalidRows, 0);

  const imported = await importTerminalReceipts({ fileName: "签收明细.xlsx", buffer, operatorName });
  assert.equal(imported.importedRows, 2);
  assert.equal(await prisma.terminalReceiptRecord.count(), 2);
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 99);

  const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { barcode } });
  assert.equal(item.ownerType, "TERMINAL_STORE");
  assert.equal(item.status, "SIGNED");
  assert.equal(item.salespersonId, null);
  assert.equal(item.terminalStoreName, "测试收货门店 A");
  const detail = await getInventoryDetail(barcode);
  assert.equal(detail.terminalReceipts.length, 1);
  assert.equal(detail.terminalReceipts[0]?.receivingOrganizationName, "测试收货门店 A");
  assert.equal(detail.terminalReceipts[0]?.matchStatus, "matched");

  const replay = await importTerminalReceipts({ fileName: "签收明细.xlsx", buffer, operatorName });
  assert.equal(replay.replayed, true);
  assert.equal(await prisma.terminalReceiptRecord.count(), 2, "相同文件不能重复写入签收记录");

  const secondReceiptAt = new Date(firstReceiptAt.getTime() + 60_000);
  const storeBBuffer = await makeTerminalReceiptWorkbook([
    { barcode, scannedAt: secondReceiptAt, storeName: "测试收货门店 B" }
  ]);
  await importTerminalReceipts({ fileName: "签收明细-B.xlsx", buffer: storeBBuffer, operatorName });
  const movedToStoreB = await prisma.inventoryItem.findUniqueOrThrow({ where: { barcode } });
  assert.equal(movedToStoreB.ownerType, "TERMINAL_STORE");
  assert.equal(movedToStoreB.terminalStoreName, "测试收货门店 B");
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 99);
  const movedDetail = await getInventoryDetail(barcode);
  assert.deepEqual(
    movedDetail.terminalReceipts.map((receipt) => receipt.receivingOrganizationName),
    ["测试收货门店 B", "测试收货门店 A"]
  );
});

test("条码流向模式无需商品库存，勤策补全商品并支持店铺间连续签收", async () => {
  const barcode = "TRACE-FAST-001";
  const requestId = randomUUID();
  const input = {
    sourceWarehouseId: context.sourceWarehouseId,
    destinationType: "salesperson" as const,
    salespersonId: context.salespersonId,
    barcodes: [barcode],
    operatorName,
    operatorUserId: currentUser.id,
    clientRequestId: requestId
  };

  const first = await submitTrackingOutbound(input);
  const replay = await submitTrackingOutbound(input);
  assert.equal(first.orderNo, replay.orderNo);
  assert.equal(first.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(await prisma.trackingOrder.count(), 1, "相同请求编号不能重复创建流转单据");
  assert.equal(await prisma.warehouseStock.count(), 0, "条码流向模式不应写入数量库存");
  assert.equal(await prisma.inventoryItem.count(), 0, "条码流向模式不应依赖旧条码库存表");

  const pending = await prisma.trackedBarcode.findUniqueOrThrow({ where: { barcode } });
  assert.equal(pending.externalGoodsName, null);
  assert.equal(pending.currentOwnerType, "SALESPERSON");
  assert.equal(pending.receiptStatus, "PENDING");

  await new Promise((resolve) => setTimeout(resolve, 10));
  const firstReceiptAt = new Date();
  const storeABuffer = await makeTerminalReceiptWorkbook([
    {
      barcode,
      scannedAt: firstReceiptAt,
      storeName: "流向测试店铺 A",
      goodsName: "125ml35度中国劲酒_1*24"
    }
  ]);
  await importTerminalReceipts({ fileName: "流向签收-A.xlsx", buffer: storeABuffer, operatorName });

  const atStoreA = await prisma.trackedBarcode.findUniqueOrThrow({ where: { barcode } });
  assert.equal(atStoreA.externalGoodsName, "125ml35度中国劲酒_1*24");
  assert.equal(atStoreA.currentOwnerType, "TERMINAL_STORE");
  assert.equal(atStoreA.terminalStoreName, "流向测试店铺 A");
  assert.equal(atStoreA.receiptStatus, "SIGNED");

  await new Promise((resolve) => setTimeout(resolve, 10));
  const storeBReceiptAt = new Date();
  const storeBBuffer = await makeTerminalReceiptWorkbook([
    {
      barcode,
      scannedAt: storeBReceiptAt,
      storeName: "流向测试店铺 B",
      goodsName: "125ml35度中国劲酒_1*24"
    }
  ]);
  await importTerminalReceipts({ fileName: "流向签收-B.xlsx", buffer: storeBBuffer, operatorName });
  const atStoreB = await prisma.trackedBarcode.findUniqueOrThrow({ where: { barcode } });
  assert.equal(atStoreB.terminalStoreName, "流向测试店铺 B");

  const detail = await getTrackedBarcodeDetail(barcode);
  assert.deepEqual(
    detail.terminalReceipts.map((receipt) => receipt.receivingOrganizationName),
    ["流向测试店铺 B", "流向测试店铺 A"]
  );
  assert.equal(detail.movements.filter((movement) => movement.type === "qince_receipt").length, 2);
  assert.equal(detail.movements.some((movement) => movement.type === "sales_outbound"), true);

  await new Promise((resolve) => setTimeout(resolve, 10));
  const returned = await submitTrackingReturn({
    returnWarehouseId: context.sourceWarehouseId,
    barcodes: [barcode],
    operatorName,
    operatorUserId: currentUser.id,
    clientRequestId: randomUUID()
  });
  assert.equal(returned.quantity, 1);
  const inWarehouse = await prisma.trackedBarcode.findUniqueOrThrow({ where: { barcode } });
  assert.equal(inWarehouse.currentOwnerType, "WAREHOUSE");
  assert.equal(inWarehouse.warehouseId, context.sourceWarehouseId);
  assert.equal(await prisma.warehouseStock.count(), 0);

  const validation = await validateTrackingBarcodes({
    mode: "return",
    returnWarehouseId: context.sourceWarehouseId,
    barcodes: [barcode]
  });
  assert.equal(validation[0]?.ok, false);
  assert.equal(validation[0]?.label, "已在仓库");

  const summary = await getTrackingSummary();
  assert.equal(summary.total, 1);
  assert.equal(summary.inWarehouses, 1);
});

test("销售出库单详情按本次流转统计整单与各商品签收率", async () => {
  const barcodes = ["ORDER-RATE-A1", "ORDER-RATE-A2", "ORDER-RATE-B1", "ORDER-RATE-PENDING"];
  const outbound = await submitTrackingOutbound({
    sourceWarehouseId: context.sourceWarehouseId,
    destinationType: "salesperson",
    salespersonId: context.salespersonId,
    barcodes,
    operatorName,
    operatorUserId: currentUser.id
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  const signedAt = new Date();
  const signedBuffer = await makeTerminalReceiptWorkbook([
    { barcode: barcodes[0], scannedAt: signedAt, storeName: "签收率测试店铺 A", goodsName: "商品甲_1*24" },
    { barcode: barcodes[1], scannedAt: signedAt, storeName: "签收率测试店铺 B", goodsName: "商品甲_1*24" },
    { barcode: barcodes[2], scannedAt: signedAt, storeName: "签收率测试店铺 C", goodsName: "商品乙_1*12" }
  ]);
  await importTerminalReceipts({ fileName: "出库单签收率.xlsx", buffer: signedBuffer, operatorName });

  await new Promise((resolve) => setTimeout(resolve, 10));
  const conflictBuffer = await makeTerminalReceiptWorkbook([
    { barcode: barcodes[2], scannedAt: new Date(), storeName: "签收率异常店铺", goodsName: "商品丙_1*6" }
  ]);
  await importTerminalReceipts({ fileName: "出库单签收异常.xlsx", buffer: conflictBuffer, operatorName });

  const detail = await getTrackingOrderDetail(outbound.orderId);
  assert.deepEqual(detail.receiptSummary, {
    total: 4,
    signed: 2,
    pending: 1,
    exceptions: 1,
    signedRate: 50
  });
  assert.deepEqual(
    detail.goodsReceiptSummaries.map((item) => ({
      goodsName: item.goodsName,
      total: item.total,
      signed: item.signed,
      pending: item.pending,
      exceptions: item.exceptions,
      signedRate: item.signedRate
    })),
    [
      { goodsName: "商品甲_1*24", total: 2, signed: 2, pending: 0, exceptions: 0, signedRate: 100 },
      { goodsName: "商品乙_1*12", total: 1, signed: 0, pending: 0, exceptions: 1, signedRate: 0 },
      { goodsName: "待勤策补全", total: 1, signed: 0, pending: 1, exceptions: 0, signedRate: 0 }
    ]
  );

  await new Promise((resolve) => setTimeout(resolve, 10));
  await submitTrackingReturn({
    returnWarehouseId: context.sourceWarehouseId,
    barcodes: [barcodes[0]],
    operatorName,
    operatorUserId: currentUser.id
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const secondOutbound = await submitTrackingOutbound({
    sourceWarehouseId: context.sourceWarehouseId,
    destinationType: "salesperson",
    salespersonId: context.salespersonId,
    barcodes: [barcodes[0]],
    operatorName,
    operatorUserId: currentUser.id
  });

  const historicalDetail = await getTrackingOrderDetail(outbound.orderId);
  const currentDetail = await getTrackingOrderDetail(secondOutbound.orderId);
  assert.equal(historicalDetail.items.find((item) => item.barcode === barcodes[0])?.receiptStatus, "signed");
  assert.equal(historicalDetail.receiptSummary?.signedRate, 50, "后续回库和再次出库不能改写旧单签收率");
  assert.equal(currentDetail.items[0]?.receiptStatus, "pending");
  assert.equal(currentDetail.receiptSummary?.signedRate, 0);
});

test("同一路线的分批销售出库可合单汇总且解除后保留原始履历", async () => {
  const batches = [
    ["GROUP-A-001", "GROUP-A-002"],
    ["GROUP-B-001", "GROUP-B-002"],
    ["GROUP-C-001", "GROUP-C-002"]
  ];
  const orders = [];
  for (const barcodes of batches) {
    orders.push(await submitTrackingOutbound({
      sourceWarehouseId: context.sourceWarehouseId,
      destinationType: "salesperson",
      salespersonId: context.salespersonId,
      barcodes,
      operatorName,
      operatorUserId: currentUser.id
    }));
  }

  const movementCountBefore = await prisma.trackingMovement.count();
  const group = await createTrackingOrderGroup({
    orderIds: orders.map((order) => order.orderId),
    operatorName,
    operatorUserId: currentUser.id
  });
  assert.equal(group.orderCount, 3);
  assert.equal(group.barcodeCount, 6);
  assert.match(group.groupNo, /^HD/);
  assert.equal(await prisma.trackingMovement.count(), movementCountBefore, "创建合单不能新增条码流转");

  const listedGroups = await listTrackingOrderGroups({ page: 1, pageSize: 20 });
  assert.equal(listedGroups.total, 1);
  assert.equal(listedGroups.items[0]?.groupNo, group.groupNo);

  const listedOrders = await listTrackingOrders({ type: "sales_outbound", page: 1, pageSize: 20 });
  assert.equal(listedOrders.items.filter((order) => order.groupNo === group.groupNo).length, 3);

  await assert.rejects(
    createTrackingOrderGroup({
      orderIds: [orders[0]!.orderId, orders[1]!.orderId],
      operatorName,
      operatorUserId: currentUser.id
    }),
    /已属于合单/
  );

  const signedAt = new Date(Date.now() + 20);
  await importTerminalReceipts({
    fileName: "合单签收率.xlsx",
    buffer: await makeTerminalReceiptWorkbook([
      { barcode: batches[0]![0]!, scannedAt: signedAt, storeName: "合单测试店铺 A", goodsName: "合单商品甲_1*24" },
      { barcode: batches[0]![1]!, scannedAt: signedAt, storeName: "合单测试店铺 B", goodsName: "合单商品甲_1*24" },
      { barcode: batches[1]![0]!, scannedAt: signedAt, storeName: "合单测试店铺 C", goodsName: "合单商品乙_1*12" }
    ]),
    operatorName
  });
  await importTerminalReceipts({
    fileName: "合单签收异常.xlsx",
    buffer: await makeTerminalReceiptWorkbook([
      { barcode: batches[1]![0]!, scannedAt: new Date(signedAt.getTime() + 20), storeName: "合单异常店铺", goodsName: "冲突商品_1*6" }
    ]),
    operatorName
  });

  const detail = await getTrackingOrderGroupDetail(group.id);
  assert.equal(detail.memberOrders.length, 3);
  assert.equal(detail.items.length, 6);
  assert.deepEqual(detail.receiptSummary, {
    total: 6,
    signed: 2,
    pending: 3,
    exceptions: 1,
    signedRate: 33.3
  });
  assert.deepEqual(
    detail.goodsReceiptSummaries.map((item) => ({
      goodsName: item.goodsName,
      total: item.total,
      signed: item.signed,
      pending: item.pending,
      exceptions: item.exceptions
    })),
    [
      { goodsName: "合单商品甲_1*24", total: 2, signed: 2, pending: 0, exceptions: 0 },
      { goodsName: "合单商品乙_1*12", total: 1, signed: 0, pending: 0, exceptions: 1 },
      { goodsName: "待勤策补全", total: 3, signed: 0, pending: 3, exceptions: 0 }
    ]
  );

  const movementCountBeforeDissolve = await prisma.trackingMovement.count();
  await dissolveTrackingOrderGroup(group.id);
  assert.equal(await prisma.trackingOrderGroup.count(), 0);
  assert.equal(await prisma.trackingOrder.count({ where: { id: { in: orders.map((order) => order.orderId) } } }), 3);
  assert.equal(await prisma.trackingMovement.count(), movementCountBeforeDissolve, "解除合单不能创建或删除条码流转");
  const ungroupedOrders = await listTrackingOrders({ type: "sales_outbound", page: 1, pageSize: 20 });
  assert.equal(ungroupedOrders.items.some((order) => order.groupId), false);
});

test("勤策商品覆盖旧系统简称且不会误报签收异常", async () => {
  const barcode = "TRACE-LEGACY-NAME-001";
  await submitTrackingOutbound({
    sourceWarehouseId: context.sourceWarehouseId,
    destinationType: "salesperson",
    salespersonId: context.salespersonId,
    barcodes: [barcode],
    operatorName,
    operatorUserId: currentUser.id
  });
  await prisma.trackedBarcode.update({
    where: { barcode },
    data: { externalGoodsName: "125劲酒", goodsUnit: "箱" }
  });

  const buffer = await makeTerminalReceiptWorkbook([
    {
      barcode,
      scannedAt: new Date(Date.now() + 1_000),
      storeName: "旧数据修复测试店铺",
      goodsName: "125ml35度中国劲酒_1*24"
    }
  ]);
  const preview = await previewTerminalReceiptImport("旧商品简称.xlsx", buffer);
  assert.equal(preview.matchedRows, 1);
  assert.equal(preview.conflictRows, 0);
  await importTerminalReceipts({ fileName: "旧商品简称.xlsx", buffer, operatorName });

  const item = await prisma.trackedBarcode.findUniqueOrThrow({ where: { barcode } });
  assert.equal(item.externalGoodsName, "125ml35度中国劲酒_1*24");
  assert.equal(item.goodsUnit, "件");
  assert.equal(item.receiptStatus, "SIGNED");
  assert.equal(item.currentOwnerType, "TERMINAL_STORE");
});

test("勤策返回不同商品名称时标记签收异常且不覆盖原商品", async () => {
  const barcode = "TRACE-CONFLICT-001";
  await submitTrackingOutbound({
    sourceWarehouseId: context.sourceWarehouseId,
    destinationType: "salesperson",
    salespersonId: context.salespersonId,
    barcodes: [barcode],
    operatorName,
    operatorUserId: currentUser.id
  });

  const firstAt = new Date(Date.now() + 1_000);
  const firstBuffer = await makeTerminalReceiptWorkbook([
    { barcode, scannedAt: firstAt, storeName: "商品冲突店铺 A", goodsName: "商品甲_1*12" }
  ]);
  await importTerminalReceipts({ fileName: "商品甲.xlsx", buffer: firstBuffer, operatorName });

  const conflictBuffer = await makeTerminalReceiptWorkbook([
    { barcode, scannedAt: new Date(firstAt.getTime() + 60_000), storeName: "商品冲突店铺 B", goodsName: "商品乙_1*6" }
  ]);
  const preview = await previewTerminalReceiptImport("商品乙.xlsx", conflictBuffer);
  assert.equal(preview.conflictRows, 1);
  await importTerminalReceipts({ fileName: "商品乙.xlsx", buffer: conflictBuffer, operatorName });

  const item = await prisma.trackedBarcode.findUniqueOrThrow({ where: { barcode } });
  assert.equal(item.externalGoodsName, "商品甲_1*12");
  assert.equal(item.receiptStatus, "EXCEPTION");
  assert.equal(item.terminalStoreName, "商品冲突店铺 B");
});

test("统一退回接收已签收货物，迟到的旧签收只补履历", async () => {
  await factoryInbound(2);
  const pendingBarcode = "RETURN-PENDING-001";
  const signedBarcode = "RETURN-SIGNED-001";
  await submitOutbound({
    type: "direct",
    sourceWarehouseId: context.sourceWarehouseId,
    salespersonId: context.salespersonId,
    goodsId: context.goodsId,
    barcodes: [pendingBarcode, signedBarcode],
    operatorName
  });
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 0);

  const outboundMovement = await prisma.stockMovement.findFirstOrThrow({
    where: { barcode: signedBarcode, type: "SALES_OUTBOUND" },
    orderBy: { occurredAt: "desc" }
  });
  const signedAt = new Date(Math.max(Date.now(), outboundMovement.occurredAt.getTime() + 1));
  const signedBuffer = await makeTerminalReceiptWorkbook([
    { barcode: signedBarcode, scannedAt: signedAt, storeName: "签收店铺 A" }
  ]);
  await importTerminalReceipts({ fileName: "已签收退回.xlsx", buffer: signedBuffer, operatorName });

  const result = await submitSalesReturn({
    returnWarehouseId: context.sourceWarehouseId,
    returnLocationId: context.sourceLocationId,
    items: [
      { barcode: pendingBarcode },
      { barcode: signedBarcode },
      { barcode: "RETURN-UNKNOWN-001", goodsId: context.goodsId }
    ],
    operatorName
  });
  assert.equal(result.pendingCount, 1);
  assert.equal(result.signedCount, 1);
  assert.equal(result.newTrackingCount, 1);
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 3);
  assert.equal(
    await prisma.inventoryItem.count({
      where: {
        barcode: { in: [pendingBarcode, signedBarcode, "RETURN-UNKNOWN-001"] },
        ownerType: "WAREHOUSE",
        status: "IN_STOCK"
      }
    }),
    3
  );

  const returnMovement = await prisma.stockMovement.findFirstOrThrow({
    where: { barcode: signedBarcode, orderId: result.orderId },
    orderBy: { occurredAt: "desc" }
  });
  const lateImportedAt = new Date(
    Math.min(returnMovement.occurredAt.getTime() - 1, signedAt.getTime() + 1)
  );
  const lateBuffer = await makeTerminalReceiptWorkbook([
    { barcode: signedBarcode, scannedAt: lateImportedAt, storeName: "迟到签收店铺" }
  ]);
  await importTerminalReceipts({ fileName: "迟到签收.xlsx", buffer: lateBuffer, operatorName });

  const conflictBuffer = await makeTerminalReceiptWorkbook([
    {
      barcode: signedBarcode,
      scannedAt: new Date(returnMovement.occurredAt.getTime() + 1),
      storeName: "流转冲突店铺"
    }
  ]);
  const conflictPreview = await previewTerminalReceiptImport("冲突签收.xlsx", conflictBuffer);
  assert.equal(conflictPreview.conflictRows, 1);
  assert.equal(conflictPreview.importableRows, 1);
  const conflictImport = await importTerminalReceipts({
    fileName: "冲突签收.xlsx",
    buffer: conflictBuffer,
    operatorName
  });
  assert.equal(conflictImport.conflictRows, 1);

  const afterLateImport = await prisma.inventoryItem.findUniqueOrThrow({ where: { barcode: signedBarcode } });
  assert.equal(afterLateImport.ownerType, "WAREHOUSE");
  assert.equal(afterLateImport.status, "IN_STOCK");
  assert.equal(afterLateImport.terminalStoreName, null);
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 3);
  const lateDetail = await getInventoryDetail(signedBarcode);
  assert.equal(lateDetail.terminalReceipts.length, 3);
  assert.equal(lateDetail.terminalReceipts.filter((receipt) => receipt.matchStatus === "conflict").length, 1);
});

test("勤策 OpenAPI 使用签名分页查询并生成可导入的扫码明细", async () => {
  const previousOpenId = process.env.QINCE_OPENID;
  const previousAppKey = process.env.QINCE_APPKEY;
  const previousBaseUrl = process.env.QINCE_OPENAPI_BASE_URL;
  process.env.QINCE_OPENID = "1234567890123456789";
  process.env.QINCE_APPKEY = "test-app-key-123456";
  process.env.QINCE_OPENAPI_BASE_URL = "https://openapi.qince.com";

  try {
    const result = await downloadQinceTerminalReceipts({
      startDate: "2026-07-07",
      endDate: "2026-07-14",
      fetchImpl: async (request, init) => {
        const url = new URL(request instanceof Request ? request.url : String(request));
        const body = String(init?.body ?? "");
        const path = url.pathname.split("/").filter(Boolean);
        const timestamp = path[5];
        const digest = path[6];
        assert.equal(path.slice(0, 4).join("/"), "api/scancode/v1/queryScancodeRecords");
        assert.equal(path[4], process.env.QINCE_OPENID);
        assert.equal(
          digest,
          createHash("md5").update(`${body}|${process.env.QINCE_APPKEY}|${timestamp}`).digest("hex")
        );
        assert.deepEqual(JSON.parse(body), {
          date_start: "2026-07-07",
          date_end: "2026-07-14",
          page: "1",
          rows: "1000"
        });
        return new Response(JSON.stringify({
          return_code: "0",
          return_msg: null,
          response_data: JSON.stringify([
            {
              id: "scan-1",
              scancode: "OPENAPI-001",
              operate_time: "2026-07-13 16:58",
              operator_name: "测试配送员",
              customer_name: "测试门店"
            }
          ])
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    });

    assert.equal(result.recordCount, 1);
    const preview = await previewTerminalReceiptImport(result.fileName, result.buffer);
    assert.equal(preview.totalRows, 1);
    assert.equal(preview.rows[0]?.barcode, "OPENAPI-001");
    assert.equal(preview.rows[0]?.receivingOrganizationName, "测试门店");
  } finally {
    restoreEnvironment("QINCE_OPENID", previousOpenId);
    restoreEnvironment("QINCE_APPKEY", previousAppKey);
    restoreEnvironment("QINCE_OPENAPI_BASE_URL", previousBaseUrl);
  }
});

test("自动签收同步推进成功截止时间并跳过重叠导出的重复记录", async () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("sheet1");
  worksheet.addRow(["码", "扫码时间", "扫码人", "商品名称", "扫码商品单位", "收货单位名称"]);
  worksheet.addRow(["SYNC-001", "2026-07-13 16:58", "测试配送员", "外部商品_1*24", "件", "测试门店一"]);
  worksheet.addRow(["SYNC-002", "2026-07-13 16:59", "测试配送员", "外部商品_1*24", "件", "测试门店二"]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const downloader = async () => ({ buffer, fileName: "自动码明细.xlsx", taskKey: randomUUID(), recordCount: 2 });

  const firstNow = new Date("2026-07-14T04:00:00.000Z");
  const first = await createTerminalReceiptSyncRun({ trigger: "MANUAL", operatorName, now: firstNow });
  assert.equal(first.exportStartDate, "2026-07-07");
  assert.equal(first.exportEndDate, "2026-07-14");
  const firstResult = await executeTerminalReceiptSync(first.id, { download: downloader });
  assert.equal(firstResult.status, "success");
  assert.equal(firstResult.importedRows, 2);
  assert.equal(await prisma.terminalReceiptRecord.count(), 2);

  const secondNow = new Date("2026-07-14T05:00:00.000Z");
  const second = await createTerminalReceiptSyncRun({ trigger: "MANUAL", operatorName, now: secondNow });
  assert.equal(second.exportStartDate, "2026-07-14", "手动同步应从最近成功截止时间继续");
  const secondResult = await executeTerminalReceiptSync(second.id, { download: downloader });
  assert.equal(secondResult.status, "success");
  assert.equal(secondResult.importedRows, 0);
  assert.equal(secondResult.duplicateRows, 2);
  assert.equal(await prisma.terminalReceiptRecord.count(), 2, "重叠导出的记录不能重复写入");

  const beforeFailure = await getTerminalReceiptSyncOverview();
  const failure = await createTerminalReceiptSyncRun({
    trigger: "MANUAL",
    operatorName,
    now: new Date("2026-07-14T06:00:00.000Z")
  });
  const failedResult = await executeTerminalReceiptSync(failure.id, {
    download: async () => { throw new Error("模拟第三方导出失败"); }
  });
  assert.equal(failedResult.status, "failure");
  const afterFailure = await getTerminalReceiptSyncOverview();
  assert.equal(afterFailure.lastSuccessfulCutoff, beforeFailure.lastSuccessfulCutoff, "失败任务不得推进同步截止时间");
});

test("浏览器连接器按固定日期领取任务并回传勤策扫码记录", async () => {
  const previousMode = process.env.QINCE_SYNC_MODE;
  const previousToken = process.env.QINCE_BROWSER_CONNECTOR_TOKEN;
  process.env.QINCE_SYNC_MODE = "browser_connector";
  process.env.QINCE_BROWSER_CONNECTOR_TOKEN = "integration-browser-connector-token";

  try {
    const run = await createTerminalReceiptSyncRun({
      trigger: "SCHEDULED",
      operatorName: "系统自动同步",
      now: new Date("2026-07-13T16:00:00.000Z")
    });
    assert.equal(run.exportStartDate, "2026-07-06");
    assert.equal(run.exportEndDate, "2026-07-12");

    const task = await claimBrowserConnectorTask(new Date("2026-07-15T01:00:00.000Z"));
    assert.ok(task);
    assert.equal(task.startDate, "2026-07-06", "电脑晚两天上线也必须保留原自然周起始日期");
    assert.equal(task.endDate, "2026-07-12", "电脑晚两天上线也必须保留原自然周结束日期");

    const result = await completeBrowserConnectorTask({
      runId: task.id,
      claimToken: task.claimToken,
      records: [{
        id: "browser-scan-1",
        goodsCode: "BROWSER-001",
        operateTime: "2026-07-08 17:32",
        operator: "测试配送员",
        productName: "外部商品_1*24",
        goodsCodeUnit: "件",
        receiveName: "测试签收门店"
      }]
    });
    assert.equal(result.status, "success");
    assert.equal(result.importedRows, 1);
    assert.equal(await prisma.terminalReceiptRecord.count({ where: { barcode: "BROWSER-001" } }), 1);
    assert.equal(await claimBrowserConnectorTask(), null);
  } finally {
    restoreEnvironment("QINCE_SYNC_MODE", previousMode);
    restoreEnvironment("QINCE_BROWSER_CONNECTOR_TOKEN", previousToken);
  }
});

test("同一时间只允许一个签收同步任务运行", async () => {
  const now = new Date();
  await createTerminalReceiptSyncRun({
    trigger: "MANUAL",
    operatorName,
    now
  });
  await assert.rejects(
    createTerminalReceiptSyncRun({
      trigger: "MANUAL",
      operatorName,
      now: new Date(now.getTime() + 60_000)
    }),
    /已有签收同步任务正在运行/
  );
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

test("业务请求编号阻止重复入库、出库和退回", async () => {
  const inboundRequestId = randomUUID();
  const inboundInput = {
    source: "factory" as const,
    warehouseId: context.sourceWarehouseId,
    locationId: context.sourceLocationId,
    goodsId: context.goodsId,
    quantity: 100,
    operatorName,
    operatorUserId: currentUser.id,
    clientRequestId: inboundRequestId
  };
  const [firstInbound, repeatedInbound] = await Promise.all([
    submitInbound(inboundInput),
    submitInbound(inboundInput)
  ]);
  assert.equal(firstInbound.orderId, repeatedInbound.orderId);
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 100);
  assert.equal(await prisma.inboundOrder.count(), 1);
  assert.equal([firstInbound.idempotentReplay, repeatedInbound.idempotentReplay].filter(Boolean).length, 1);

  await assert.rejects(
    submitInbound({ ...inboundInput, quantity: 101 }),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 409
  );

  const outboundInput = {
    type: "direct" as const,
    sourceWarehouseId: context.sourceWarehouseId,
    salespersonId: context.salespersonId,
    goodsId: context.goodsId,
    barcodes: ["IDEMPOTENT-SALES-001"],
    operatorName,
    operatorUserId: currentUser.id,
    clientRequestId: randomUUID()
  };
  const firstOutbound = await submitOutbound(outboundInput);
  const repeatedOutbound = await submitOutbound(outboundInput);
  assert.equal(firstOutbound.orderId, repeatedOutbound.orderId);
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 99);

  const returnInput = {
    returnWarehouseId: context.sourceWarehouseId,
    returnLocationId: context.sourceLocationId,
    barcodes: ["IDEMPOTENT-SALES-001"],
    operatorName,
    operatorUserId: currentUser.id,
    clientRequestId: randomUUID()
  };
  const firstReturn = await submitSalesReturn(returnInput);
  const repeatedReturn = await submitSalesReturn(returnInput);
  assert.equal(firstReturn.orderId, repeatedReturn.orderId);
  assert.equal(await stockQuantity(context.sourceWarehouseId, context.goodsId), 100);
});

test("账号密码、角色和启停状态按安全规则维护", async () => {
  await prisma.userSession.createMany({
    data: [
      { token: "current-session", userId: currentUser.id, expiresAt: new Date(Date.now() + 60_000) },
      { token: "other-session", userId: currentUser.id, expiresAt: new Date(Date.now() + 60_000) }
    ]
  });
  await changeOwnPassword({
    userId: currentUser.id,
    currentPassword: "integration-test-password",
    newPassword: "changed-test-password",
    currentSessionToken: "current-session"
  });
  const changedUser = await prisma.user.findUniqueOrThrow({ where: { id: currentUser.id } });
  assert.equal(await verifyPassword("changed-test-password", changedUser.passwordHash), true);
  assert.equal(await prisma.userSession.count({ where: { userId: currentUser.id } }), 1);

  const managed = await createUser({
    username: "managed_test_user",
    displayName: "被管理测试用户",
    password: "initial-password",
    roleCode: "WAREHOUSE_ADMIN"
  });
  await prisma.userSession.create({
    data: { token: "managed-session", userId: managed.id, expiresAt: new Date(Date.now() + 60_000) }
  });
  const disabled = await updateUser(
    managed.id,
    { displayName: "被停用测试用户", roleCode: "INVENTORY_VIEWER", status: "disabled" },
    currentUser.id
  );
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.roles[0]?.code, "INVENTORY_VIEWER");
  assert.equal(await prisma.userSession.count({ where: { userId: managed.id } }), 0);

  await resetUserPassword(managed.id, "reset-password-123", currentUser.id);
  const resetUser = await prisma.user.findUniqueOrThrow({ where: { id: managed.id } });
  assert.equal(await verifyPassword("reset-password-123", resetUser.passwordHash), true);

  await assert.rejects(
    updateUser(
      currentUser.id,
      { displayName: currentUser.displayName, roleCode: "WAREHOUSE_ADMIN", status: "enabled" },
      currentUser.id
    ),
    /不能停用或降级当前登录/
  );
  await assert.rejects(
    updateUser(
      currentUser.id,
      { displayName: currentUser.displayName, roleCode: "WAREHOUSE_ADMIN", status: "enabled" },
      randomUUID()
    ),
    /至少一个启用的超级管理员/
  );
});

test("一致性检查区分错误和历史基线提示，并限制普通账号访问", async () => {
  await factoryInbound(10);
  let audit = await runConsistencyAudit();
  assert.equal(audit.healthy, true);
  assert.equal(audit.severityCounts.error, 0);

  await prisma.warehouseStock.create({
    data: { warehouseId: context.targetWarehouseId, goodsId: context.goodsId, quantity: 5 }
  });
  audit = await runConsistencyAudit();
  assert.equal(audit.healthy, true, "只有历史基线提示时不应判定账目故障");
  assert.equal(audit.categoryCounts.STOCK_MISSING_BASELINE, 1);

  await prisma.warehouseStock.update({
    where: { warehouseId_goodsId: { warehouseId: context.sourceWarehouseId, goodsId: context.goodsId } },
    data: { quantity: { increment: 1 } }
  });
  audit = await runConsistencyAudit();
  assert.equal(audit.healthy, false);
  assert.equal(audit.categoryCounts.STOCK_BALANCE_MISMATCH, 1);

  const viewerRole = await prisma.role.findUniqueOrThrow({ where: { code: "INVENTORY_VIEWER" } });
  const viewer = await prisma.user.create({
    data: {
      username: "audit_viewer",
      displayName: "审计只读用户",
      passwordHash: "viewer-password",
      roles: { create: { roleId: viewerRole.id } },
      sessions: { create: { token: "audit-viewer-session", expiresAt: new Date(Date.now() + 60_000) } }
    }
  });
  const response = await getConsistencyAudit(new Request("http://localhost/api/system/consistency-audit", {
    headers: { cookie: "warehouse_session=audit-viewer-session" }
  }));
  assert.equal(response.status, 403);
  assert.equal(await prisma.operationLog.count({ where: { targetType: "SYSTEM" } }), 1);
  assert.ok(viewer.id);
});

test("健康检查返回应用、数据库和接口版本", async () => {
  const response = await getHealth();
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data: { status: string; database: string; webVersion: string; apiContractVersion: string; serverTime: string };
  };
  assert.equal(payload.data.status, "ok");
  assert.equal(payload.data.database, "ok");
  assert.match(payload.data.webVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(payload.data.apiContractVersion, "1");
  assert.ok(Date.parse(payload.data.serverTime));

  const statusFile = `/tmp/warehouse-backup-status-${process.pid}.json`;
  const previousStatusFile = process.env.BACKUP_STATUS_FILE;
  process.env.BACKUP_STATUS_FILE = statusFile;
  await writeFile(statusFile, JSON.stringify({
    status: "success",
    completedAt: "2026-07-10T10:00:00.000Z",
    fileName: "warehouse_test.dump",
    sizeBytes: 1024,
    checksumVerified: true,
    destination: "oss",
    message: "测试备份成功"
  }));
  await prisma.userSession.create({
    data: { token: "health-super-session", userId: currentUser.id, expiresAt: new Date(Date.now() + 60_000) }
  });
  try {
    const backupResponse = await getBackupStatus(new Request("http://localhost/api/system/backup-status", {
      headers: { cookie: "warehouse_session=health-super-session" }
    }));
    assert.equal(backupResponse.status, 200);
    const backupPayload = (await backupResponse.json()) as { data: { status: string; destination: string } };
    assert.equal(backupPayload.data.status, "success");
    assert.equal(backupPayload.data.destination, "oss");
  } finally {
    if (previousStatusFile === undefined) delete process.env.BACKUP_STATUS_FILE;
    else process.env.BACKUP_STATUS_FILE = previousStatusFile;
    await rm(statusFile, { force: true });
  }
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

async function makeTerminalReceiptWorkbook(
  rows: Array<{ barcode: string; scannedAt: Date; storeName: string; scannerName?: string; goodsName?: string }>
) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("sheet1");
  worksheet.addRow(["码", "扫码时间", "扫码人", "商品名称", "扫码商品单位", "收货单位名称"]);
  for (const row of rows) {
    worksheet.addRow([
      row.barcode,
      row.scannedAt,
      row.scannerName ?? "测试配送员",
      row.goodsName ?? "外部系统商品名称_1*24",
      "件",
      row.storeName
    ]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function seedContext() {
  const goodsId = randomUUID();
  const sourceWarehouseId = randomUUID();
  const sourceLocationId = randomUUID();
  const targetWarehouseId = randomUUID();
  const targetLocationId = randomUUID();
  const salespersonId = randomUUID();
  const storeId = randomUUID();
  const superAdminRoleId = randomUUID();
  await prisma.role.createMany({
    data: [
      { id: superAdminRoleId, code: "SUPER_ADMIN", name: "超级管理员" },
      { id: randomUUID(), code: "WAREHOUSE_ADMIN", name: "仓库管理员" },
      { id: randomUUID(), code: "INVENTORY_VIEWER", name: "只读查询人员" }
    ]
  });
  await prisma.user.create({
    data: {
      id: currentUser.id,
      username: currentUser.username,
      displayName: currentUser.displayName,
      passwordHash: "integration-test-password",
      roles: { create: { roleId: superAdminRoleId } }
    }
  });
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
