import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { after, beforeEach, test } from "node:test";

import { getPrisma } from "@/lib/db";
import { correctBarcode, writeOffBarcode } from "@/lib/services/barcode-management-service";
import { runConsistencyAudit } from "@/lib/services/consistency-audit-service";
import { submitInbound } from "@/lib/services/inbound-service";
import { getInventoryDetail, listInventory } from "@/lib/services/inventory-query-service";
import { listOrderSummaries } from "@/lib/services/order-service";
import { voidOrders } from "@/lib/services/order-reversal-service";
import { submitOutbound } from "@/lib/services/outbound-service";
import { submitSalesReturn } from "@/lib/services/sales-return-service";
import { adjustStockManually } from "@/lib/services/stock-adjustment-service";
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
