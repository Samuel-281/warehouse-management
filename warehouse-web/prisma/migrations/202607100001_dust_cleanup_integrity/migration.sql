CREATE TYPE "OrderStatus" AS ENUM ('ACTIVE', 'VOIDED');

ALTER TYPE "ItemStatus" ADD VALUE IF NOT EXISTS 'WRITTEN_OFF';
ALTER TYPE "ItemStatus" ADD VALUE IF NOT EXISTS 'VOIDED';

ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'ORDER_REVERSAL';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'BARCODE_CORRECTION';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'WRITE_OFF';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'MANUAL_ADJUSTMENT';

ALTER TABLE "warehouses" DROP CONSTRAINT IF EXISTS "warehouses_parentId_fkey";
DROP INDEX IF EXISTS "warehouses_parentId_idx";
ALTER TABLE "warehouses" DROP COLUMN IF EXISTS "parentId";
ALTER TABLE "warehouses" DROP COLUMN IF EXISTS "type";
DROP TYPE IF EXISTS "WarehouseType";

ALTER TABLE "inbound_orders"
  ADD COLUMN "status" "OrderStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "reversalSupported" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedByUserId" UUID,
  ADD COLUMN "voidedByName" TEXT,
  ADD COLUMN "voidReason" TEXT;
ALTER TABLE "inbound_orders" ALTER COLUMN "reversalSupported" SET DEFAULT true;

ALTER TABLE "outbound_orders"
  ADD COLUMN "status" "OrderStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "reversalSupported" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedByUserId" UUID,
  ADD COLUMN "voidedByName" TEXT,
  ADD COLUMN "voidReason" TEXT;
ALTER TABLE "outbound_orders" ALTER COLUMN "reversalSupported" SET DEFAULT true;

ALTER TABLE "sales_return_orders"
  ADD COLUMN "status" "OrderStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "reversalSupported" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedByUserId" UUID,
  ADD COLUMN "voidedByName" TEXT,
  ADD COLUMN "voidReason" TEXT;
ALTER TABLE "sales_return_orders" ALTER COLUMN "reversalSupported" SET DEFAULT true;

ALTER TABLE "inbound_order_items"
  ADD COLUMN "beforeOwnerType" "OwnerType",
  ADD COLUMN "beforeWarehouseId" UUID,
  ADD COLUMN "beforeLocationId" UUID,
  ADD COLUMN "beforeSalespersonId" UUID,
  ADD COLUMN "createdTrackingItem" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "outbound_order_items"
  ADD COLUMN "beforeOwnerType" "OwnerType",
  ADD COLUMN "beforeWarehouseId" UUID,
  ADD COLUMN "beforeLocationId" UUID,
  ADD COLUMN "beforeSalespersonId" UUID,
  ADD COLUMN "createdTrackingItem" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "sales_return_order_items"
  ADD COLUMN "beforeOwnerType" "OwnerType" DEFAULT 'SALESPERSON',
  ADD COLUMN "beforeWarehouseId" UUID,
  ADD COLUMN "beforeLocationId" UUID,
  ADD COLUMN "beforeSalespersonId" UUID;
UPDATE "sales_return_order_items"
SET "beforeSalespersonId" = "fromSalespersonId"
WHERE "beforeSalespersonId" IS NULL;

ALTER TABLE "stock_movements"
  ADD COLUMN "orderKind" TEXT,
  ADD COLUMN "orderId" UUID,
  ADD COLUMN "orderNo" TEXT,
  ADD COLUMN "reversalOfMovementId" UUID;

ALTER TABLE "warehouse_stock_movements"
  ADD COLUMN "orderNo" TEXT,
  ADD COLUMN "reversalOfMovementId" UUID;

CREATE TABLE "barcode_corrections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "itemId" UUID NOT NULL,
  "oldBarcode" TEXT NOT NULL,
  "newBarcode" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "operatorName" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "barcode_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "barcode_corrections_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "barcode_corrections_oldBarcode_key" ON "barcode_corrections"("oldBarcode");
CREATE INDEX "barcode_corrections_itemId_occurredAt_idx" ON "barcode_corrections"("itemId", "occurredAt");
CREATE INDEX "barcode_corrections_newBarcode_idx" ON "barcode_corrections"("newBarcode");

CREATE INDEX "inbound_orders_status_createdAt_idx" ON "inbound_orders"("status", "createdAt");
CREATE INDEX "outbound_orders_status_createdAt_idx" ON "outbound_orders"("status", "createdAt");
CREATE INDEX "sales_return_orders_status_createdAt_idx" ON "sales_return_orders"("status", "createdAt");

CREATE INDEX "inbound_order_items_orderId_idx" ON "inbound_order_items"("orderId");
CREATE INDEX "inbound_order_items_inventoryItemId_idx" ON "inbound_order_items"("inventoryItemId");
CREATE INDEX "outbound_order_items_orderId_idx" ON "outbound_order_items"("orderId");
CREATE INDEX "outbound_order_items_inventoryItemId_idx" ON "outbound_order_items"("inventoryItemId");
CREATE INDEX "sales_return_order_items_orderId_idx" ON "sales_return_order_items"("orderId");
CREATE INDEX "sales_return_order_items_inventoryItemId_idx" ON "sales_return_order_items"("inventoryItemId");
CREATE INDEX "stock_movements_orderKind_orderId_idx" ON "stock_movements"("orderKind", "orderId");
CREATE INDEX "warehouse_stock_movements_orderKind_orderId_idx"
  ON "warehouse_stock_movements"("orderKind", "orderId");

ALTER TABLE "warehouse_stocks"
  ADD CONSTRAINT "warehouse_stocks_quantity_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "inbound_order_items"
  ADD CONSTRAINT "inbound_order_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_owner_consistency" CHECK (
    ("ownerType" = 'WAREHOUSE' AND "warehouseId" IS NOT NULL AND "salespersonId" IS NULL)
    OR
    ("ownerType" = 'SALESPERSON' AND "salespersonId" IS NOT NULL AND "warehouseId" IS NULL AND "locationId" IS NULL)
  );
