CREATE TABLE "warehouse_stocks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "warehouseId" UUID NOT NULL,
  "goodsId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "lastChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "warehouse_stocks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "warehouse_stock_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "warehouseId" UUID NOT NULL,
  "goodsId" UUID NOT NULL,
  "type" "MovementType" NOT NULL,
  "quantityChange" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "orderKind" TEXT,
  "orderId" UUID,
  "barcode" TEXT,
  "counterparty" TEXT,
  "operatorName" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "note" TEXT NOT NULL,

  CONSTRAINT "warehouse_stock_movements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "inbound_order_items"
  ALTER COLUMN "inventoryItemId" DROP NOT NULL,
  ALTER COLUMN "barcode" DROP NOT NULL,
  ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "warehouse_stocks_warehouseId_goodsId_key"
  ON "warehouse_stocks"("warehouseId", "goodsId");
CREATE INDEX "warehouse_stocks_goodsId_idx" ON "warehouse_stocks"("goodsId");
CREATE INDEX "warehouse_stocks_lastChangedAt_idx" ON "warehouse_stocks"("lastChangedAt");
CREATE INDEX "warehouse_stock_movements_warehouseId_goodsId_idx"
  ON "warehouse_stock_movements"("warehouseId", "goodsId");
CREATE INDEX "warehouse_stock_movements_goodsId_idx" ON "warehouse_stock_movements"("goodsId");
CREATE INDEX "warehouse_stock_movements_occurredAt_idx" ON "warehouse_stock_movements"("occurredAt");
CREATE INDEX "warehouse_stock_movements_barcode_idx" ON "warehouse_stock_movements"("barcode");

ALTER TABLE "warehouse_stocks"
  ADD CONSTRAINT "warehouse_stocks_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse_stocks"
  ADD CONSTRAINT "warehouse_stocks_goodsId_fkey"
  FOREIGN KEY ("goodsId") REFERENCES "goods"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse_stock_movements"
  ADD CONSTRAINT "warehouse_stock_movements_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse_stock_movements"
  ADD CONSTRAINT "warehouse_stock_movements_goodsId_fkey"
  FOREIGN KEY ("goodsId") REFERENCES "goods"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "warehouse_stocks" ("warehouseId", "goodsId", "quantity", "lastChangedAt", "createdAt", "updatedAt")
SELECT
  "warehouseId",
  "goodsId",
  COUNT(*)::INTEGER AS "quantity",
  MAX("lastMovedAt") AS "lastChangedAt",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "inventory_items"
WHERE "ownerType" = 'WAREHOUSE'
  AND "warehouseId" IS NOT NULL
GROUP BY "warehouseId", "goodsId"
ON CONFLICT ("warehouseId", "goodsId")
DO UPDATE SET
  "quantity" = EXCLUDED."quantity",
  "lastChangedAt" = EXCLUDED."lastChangedAt",
  "updatedAt" = CURRENT_TIMESTAMP;
