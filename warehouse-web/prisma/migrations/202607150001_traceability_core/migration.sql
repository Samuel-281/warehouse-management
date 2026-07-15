-- Traceability-first model. Legacy stock and goods tables remain available for historical queries.
CREATE TYPE "TrackingOrderType" AS ENUM ('SALES_OUTBOUND', 'TRANSFER', 'RETURN');
CREATE TYPE "TrackingReceiptStatus" AS ENUM ('PENDING', 'SIGNED', 'EXCEPTION');
CREATE TYPE "TrackingItemStatus" AS ENUM ('ACTIVE', 'WRITTEN_OFF', 'VOIDED');
CREATE TYPE "TrackingMovementType" AS ENUM (
  'LEGACY_INBOUND',
  'SALES_OUTBOUND',
  'TRANSFER',
  'RETURN',
  'QINCE_RECEIPT',
  'ORDER_REVERSAL',
  'BARCODE_CORRECTION',
  'WRITE_OFF'
);

CREATE TABLE "tracked_barcodes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "barcode" TEXT NOT NULL,
  "externalGoodsName" TEXT,
  "goodsUnit" TEXT,
  "currentOwnerType" "OwnerType" NOT NULL,
  "warehouseId" UUID,
  "salespersonId" UUID,
  "terminalStoreName" TEXT,
  "receiptStatus" "TrackingReceiptStatus" NOT NULL DEFAULT 'PENDING',
  "status" "TrackingItemStatus" NOT NULL DEFAULT 'ACTIVE',
  "signedAt" TIMESTAMP(3),
  "lastMovedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracked_barcodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tracking_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderNo" TEXT NOT NULL,
  "type" "TrackingOrderType" NOT NULL,
  "sourceWarehouseId" UUID,
  "targetWarehouseId" UUID,
  "salespersonId" UUID,
  "operatorId" UUID,
  "operatorName" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'ACTIVE',
  "voidedAt" TIMESTAMP(3),
  "voidedByUserId" UUID,
  "voidedByName" TEXT,
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracking_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tracking_order_barcodes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "trackedBarcodeId" UUID NOT NULL,
  "barcode" TEXT NOT NULL,
  "beforeOwnerType" "OwnerType",
  "beforeWarehouseId" UUID,
  "beforeSalespersonId" UUID,
  "beforeTerminalStoreName" TEXT,
  "beforeReceiptStatus" "TrackingReceiptStatus",
  "createdTrackingItem" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "tracking_order_barcodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tracking_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "trackedBarcodeId" UUID NOT NULL,
  "barcode" TEXT NOT NULL,
  "type" "TrackingMovementType" NOT NULL,
  "fromOwnerType" "OwnerType",
  "toOwnerType" "OwnerType" NOT NULL,
  "fromLabel" TEXT NOT NULL,
  "toLabel" TEXT NOT NULL,
  "operatorId" UUID,
  "operatorName" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "note" TEXT NOT NULL,
  "orderId" UUID,
  "orderNo" TEXT,
  "receiptRecordId" UUID,
  CONSTRAINT "tracking_movements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "terminal_receipt_records" ADD COLUMN "trackedBarcodeId" UUID;

CREATE UNIQUE INDEX "tracked_barcodes_barcode_key" ON "tracked_barcodes"("barcode");
CREATE INDEX "tracked_barcodes_currentOwnerType_warehouseId_lastMovedAt_idx" ON "tracked_barcodes"("currentOwnerType", "warehouseId", "lastMovedAt" DESC);
CREATE INDEX "tracked_barcodes_currentOwnerType_salespersonId_lastMovedAt_idx" ON "tracked_barcodes"("currentOwnerType", "salespersonId", "lastMovedAt" DESC);
CREATE INDEX "tracked_barcodes_receiptStatus_lastMovedAt_idx" ON "tracked_barcodes"("receiptStatus", "lastMovedAt" DESC);
CREATE INDEX "tracked_barcodes_externalGoodsName_idx" ON "tracked_barcodes"("externalGoodsName");
CREATE INDEX "tracked_barcodes_terminalStoreName_idx" ON "tracked_barcodes"("terminalStoreName");

CREATE UNIQUE INDEX "tracking_orders_orderNo_key" ON "tracking_orders"("orderNo");
CREATE INDEX "tracking_orders_type_createdAt_idx" ON "tracking_orders"("type", "createdAt" DESC);
CREATE INDEX "tracking_orders_sourceWarehouseId_createdAt_idx" ON "tracking_orders"("sourceWarehouseId", "createdAt" DESC);
CREATE INDEX "tracking_orders_targetWarehouseId_createdAt_idx" ON "tracking_orders"("targetWarehouseId", "createdAt" DESC);
CREATE INDEX "tracking_orders_salespersonId_createdAt_idx" ON "tracking_orders"("salespersonId", "createdAt" DESC);
CREATE INDEX "tracking_orders_status_createdAt_idx" ON "tracking_orders"("status", "createdAt" DESC);

CREATE UNIQUE INDEX "tracking_order_barcodes_orderId_barcode_key" ON "tracking_order_barcodes"("orderId", "barcode");
CREATE INDEX "tracking_order_barcodes_barcode_idx" ON "tracking_order_barcodes"("barcode");
CREATE INDEX "tracking_order_barcodes_trackedBarcodeId_idx" ON "tracking_order_barcodes"("trackedBarcodeId");

CREATE UNIQUE INDEX "tracking_movements_receiptRecordId_key" ON "tracking_movements"("receiptRecordId");
CREATE INDEX "tracking_movements_trackedBarcodeId_occurredAt_idx" ON "tracking_movements"("trackedBarcodeId", "occurredAt" DESC);
CREATE INDEX "tracking_movements_barcode_occurredAt_idx" ON "tracking_movements"("barcode", "occurredAt" DESC);
CREATE INDEX "tracking_movements_orderId_idx" ON "tracking_movements"("orderId");
CREATE INDEX "tracking_movements_type_occurredAt_idx" ON "tracking_movements"("type", "occurredAt" DESC);
CREATE INDEX "terminal_receipt_records_trackedBarcodeId_scannedAt_idx" ON "terminal_receipt_records"("trackedBarcodeId", "scannedAt" DESC);

ALTER TABLE "tracked_barcodes" ADD CONSTRAINT "tracked_barcodes_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tracked_barcodes" ADD CONSTRAINT "tracked_barcodes_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salespeople"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tracking_orders" ADD CONSTRAINT "tracking_orders_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tracking_orders" ADD CONSTRAINT "tracking_orders_targetWarehouseId_fkey" FOREIGN KEY ("targetWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tracking_orders" ADD CONSTRAINT "tracking_orders_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salespeople"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tracking_orders" ADD CONSTRAINT "tracking_orders_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tracking_order_barcodes" ADD CONSTRAINT "tracking_order_barcodes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "tracking_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tracking_order_barcodes" ADD CONSTRAINT "tracking_order_barcodes_trackedBarcodeId_fkey" FOREIGN KEY ("trackedBarcodeId") REFERENCES "tracked_barcodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tracking_movements" ADD CONSTRAINT "tracking_movements_trackedBarcodeId_fkey" FOREIGN KEY ("trackedBarcodeId") REFERENCES "tracked_barcodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tracking_movements" ADD CONSTRAINT "tracking_movements_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tracking_movements" ADD CONSTRAINT "tracking_movements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "tracking_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tracking_movements" ADD CONSTRAINT "tracking_movements_receiptRecordId_fkey" FOREIGN KEY ("receiptRecordId") REFERENCES "terminal_receipt_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "terminal_receipt_records" ADD CONSTRAINT "terminal_receipt_records_trackedBarcodeId_fkey" FOREIGN KEY ("trackedBarcodeId") REFERENCES "tracked_barcodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve every legacy tracked barcode without changing legacy stock or order records.
INSERT INTO "tracked_barcodes" (
  "id", "barcode", "externalGoodsName", "goodsUnit", "currentOwnerType", "warehouseId", "salespersonId",
  "terminalStoreName", "receiptStatus", "status", "signedAt", "lastMovedAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  item."barcode",
  goods."name",
  goods."unit",
  item."ownerType",
  item."warehouseId",
  item."salespersonId",
  item."terminalStoreName",
  CASE
    WHEN item."status" = 'SIGNED' THEN 'SIGNED'::"TrackingReceiptStatus"
    WHEN item."status" = 'RECEIPT_EXCEPTION' THEN 'EXCEPTION'::"TrackingReceiptStatus"
    ELSE 'PENDING'::"TrackingReceiptStatus"
  END,
  CASE
    WHEN item."status" = 'WRITTEN_OFF' THEN 'WRITTEN_OFF'::"TrackingItemStatus"
    WHEN item."status" = 'VOIDED' THEN 'VOIDED'::"TrackingItemStatus"
    ELSE 'ACTIVE'::"TrackingItemStatus"
  END,
  item."signedAt",
  item."lastMovedAt",
  item."createdAt",
  item."updatedAt"
FROM "inventory_items" item
JOIN "goods" goods ON goods."id" = item."goodsId"
ON CONFLICT ("barcode") DO NOTHING;

INSERT INTO "tracking_movements" (
  "id", "trackedBarcodeId", "barcode", "type", "fromOwnerType", "toOwnerType", "fromLabel", "toLabel",
  "operatorId", "operatorName", "occurredAt", "note", "orderId", "orderNo"
)
SELECT
  gen_random_uuid(),
  tracked."id",
  movement."barcode",
  CASE
    WHEN movement."type" = 'SALES_OUTBOUND' THEN 'SALES_OUTBOUND'::"TrackingMovementType"
    WHEN movement."type" = 'TRANSFER' THEN 'TRANSFER'::"TrackingMovementType"
    WHEN movement."type" = 'SALES_RETURN' THEN 'RETURN'::"TrackingMovementType"
    WHEN movement."type" = 'ORDER_REVERSAL' THEN 'ORDER_REVERSAL'::"TrackingMovementType"
    WHEN movement."type" = 'BARCODE_CORRECTION' THEN 'BARCODE_CORRECTION'::"TrackingMovementType"
    WHEN movement."type" = 'WRITE_OFF' THEN 'WRITE_OFF'::"TrackingMovementType"
    ELSE 'LEGACY_INBOUND'::"TrackingMovementType"
  END,
  CASE
    WHEN movement."type" IN ('SALES_OUTBOUND', 'TRANSFER') THEN 'WAREHOUSE'::"OwnerType"
    WHEN movement."type" = 'SALES_RETURN' THEN 'SALESPERSON'::"OwnerType"
    WHEN movement."type" = 'TERMINAL_RETURN_INBOUND' THEN 'TERMINAL_STORE'::"OwnerType"
    ELSE NULL
  END,
  CASE WHEN movement."type" = 'SALES_OUTBOUND' THEN 'SALESPERSON'::"OwnerType" ELSE 'WAREHOUSE'::"OwnerType" END,
  movement."fromLabel",
  movement."toLabel",
  movement."operatorId",
  movement."operatorName",
  movement."occurredAt",
  movement."note",
  NULL,
  movement."orderNo"
FROM "stock_movements" movement
JOIN "tracked_barcodes" tracked ON tracked."barcode" = movement."barcode";

UPDATE "terminal_receipt_records" receipt
SET "trackedBarcodeId" = tracked."id"
FROM "tracked_barcodes" tracked
WHERE tracked."barcode" = receipt."barcode";

INSERT INTO "tracking_movements" (
  "id", "trackedBarcodeId", "barcode", "type", "fromOwnerType", "toOwnerType", "fromLabel", "toLabel",
  "operatorName", "occurredAt", "note", "receiptRecordId"
)
SELECT
  gen_random_uuid(),
  receipt."trackedBarcodeId",
  receipt."barcode",
  'QINCE_RECEIPT'::"TrackingMovementType",
  'SALESPERSON'::"OwnerType",
  'TERMINAL_STORE'::"OwnerType",
  '签收前归属',
  '终端店铺：' || receipt."receivingOrganizationName",
  '勤策同步',
  receipt."scannedAt",
  '勤策扫码签收；商品：' || receipt."externalGoodsName",
  receipt."id"
FROM "terminal_receipt_records" receipt
WHERE receipt."trackedBarcodeId" IS NOT NULL AND receipt."matchStatus" = 'MATCHED';
