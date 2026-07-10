import { performance } from "node:perf_hooks";

import { getPrisma } from "@/lib/db";
import { getInventorySummary, listInventory } from "@/lib/services/inventory-query-service";
import { listOrderSummaries } from "@/lib/services/order-service";

async function main() {
  const prisma = getPrisma();
  try {
  const barcodeArg = process.argv.find((argument) => argument.startsWith("--barcode="))?.slice("--barcode=".length);
  const barcode =
    barcodeArg ||
    (
      await prisma.inventoryItem.findFirst({
        orderBy: { createdAt: "desc" },
        select: { barcode: true }
      })
    )?.barcode;
  if (!barcode) throw new Error("数据库中没有可用于基准测试的条码");

  const summary = await measure("首页库存摘要", () => getInventorySummary());
  const firstPage = await measure("库存第一页", () => listInventory({ page: 1, pageSize: 20 }));
  const exactInventory = await measure("完整条码库存查询", () =>
    listInventory({ keyword: barcode, page: 1, pageSize: 20 })
  );
  const orderPage = await measure("单据第一页", () => listOrderSummaries({ page: 1, pageSize: 20 }));
  const exactOrders = await measure("完整条码单据查询", () =>
    listOrderSummaries({ barcode, page: 1, pageSize: 20 })
  );

  if (exactInventory.elapsedMs >= 500 || exactOrders.elapsedMs >= 500) {
    throw new Error("完整条码查询超过 500ms 性能门槛");
  }
  console.log(
    JSON.stringify(
      {
        barcode,
        trackedItems: summary.value.totalItems,
        warehouseQuantity: summary.value.totalWarehouseQuantity,
        inventoryTotal: firstPage.value.total,
        orderTotal: orderPage.value.total,
        exactInventoryMatches: exactInventory.value.total,
        exactOrderMatches: exactOrders.value.total
      },
      null,
      2
    )
  );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function measure<T>(label: string, operation: () => Promise<T>) {
  const startedAt = performance.now();
  const value = await operation();
  const elapsedMs = performance.now() - startedAt;
  console.log(`${label}: ${Math.round(elapsedMs)}ms`);
  return { value, elapsedMs };
}
