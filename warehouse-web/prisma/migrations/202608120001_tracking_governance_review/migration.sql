ALTER TYPE "TrackingMovementType" ADD VALUE IF NOT EXISTS 'ORDER_CORRECTION';
ALTER TYPE "TrackingMovementType" ADD VALUE IF NOT EXISTS 'TRACKING_VOID';

CREATE TYPE "TrackingReviewStatus" AS ENUM ('PENDING', 'REVIEWED', 'EXEMPT');
CREATE TYPE "TrackingOrderStatus" AS ENUM ('ACTIVE', 'MERGED', 'VOIDED');
CREATE TYPE "TrackingGroupStatus" AS ENUM ('ACTIVE', 'VOIDED');
CREATE TYPE "ProductCategorySource" AS ENUM ('MANUAL', 'QINCE');
CREATE TYPE "TrackingReviewTargetType" AS ENUM ('ORDER', 'GROUP');
CREATE TYPE "TrackingCorrectionTargetType" AS ENUM ('ORDER', 'GROUP');

CREATE TABLE "product_categories" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "status" "RecordStatus" NOT NULL DEFAULT 'ENABLED',
  "source" "ProductCategorySource" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_categories_name_not_blank" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "product_categories_normalized_name_not_blank" CHECK (length(btrim("normalizedName")) > 0)
);

CREATE UNIQUE INDEX "product_categories_normalizedName_key" ON "product_categories"("normalizedName");
CREATE INDEX "product_categories_status_name_idx" ON "product_categories"("status", "name");

ALTER TABLE "terminal_receipt_records" ADD COLUMN "productCategoryId" UUID;
ALTER TABLE "tracked_barcodes" ADD COLUMN "productCategoryId" UUID;
CREATE INDEX "terminal_receipt_records_productCategoryId_idx" ON "terminal_receipt_records"("productCategoryId");
CREATE INDEX "tracked_barcodes_productCategoryId_idx" ON "tracked_barcodes"("productCategoryId");
ALTER TABLE "terminal_receipt_records" ADD CONSTRAINT "terminal_receipt_records_productCategoryId_fkey"
  FOREIGN KEY ("productCategoryId") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tracked_barcodes" ADD CONSTRAINT "tracked_barcodes_productCategoryId_fkey"
  FOREIGN KEY ("productCategoryId") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tracking_orders"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "TrackingOrderStatus" USING ("status"::text::"TrackingOrderStatus"),
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE',
  ADD COLUMN "reviewStatus" "TrackingReviewStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "correctedAfterReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tracking_order_barcodes"
  ADD COLUMN "beforeSignedAt" TIMESTAMP(3);
ALTER TABLE "tracking_order_groups"
  ADD COLUMN "status" "TrackingGroupStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "reviewStatus" "TrackingReviewStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "correctedAfterReview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "correctedAt" TIMESTAMP(3),
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedByUserId" UUID,
  ADD COLUMN "voidedByName" TEXT,
  ADD COLUMN "voidReason" TEXT;

ALTER TABLE "tracking_movements"
  ADD COLUMN "groupId" UUID,
  ADD COLUMN "groupNo" TEXT;
CREATE INDEX "tracking_movements_groupId_idx" ON "tracking_movements"("groupId");
ALTER TABLE "tracking_movements" ADD CONSTRAINT "tracking_movements_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "tracking_order_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tracking_orders_reviewStatus_createdAt_idx" ON "tracking_orders"("reviewStatus", "createdAt" DESC);
CREATE INDEX "tracking_order_groups_status_reviewStatus_createdAt_idx" ON "tracking_order_groups"("status", "reviewStatus", "createdAt" DESC);

CREATE TABLE "tracking_order_reviews" (
  "id" UUID NOT NULL,
  "targetType" "TrackingReviewTargetType" NOT NULL,
  "orderId" UUID,
  "groupId" UUID,
  "version" INTEGER NOT NULL,
  "actualTotalQuantity" INTEGER NOT NULL,
  "activeBarcodeCount" INTEGER NOT NULL,
  "operatorId" UUID,
  "operatorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracking_order_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tracking_order_reviews_target_check" CHECK (
    ("targetType" = 'ORDER' AND "orderId" IS NOT NULL AND "groupId" IS NULL) OR
    ("targetType" = 'GROUP' AND "groupId" IS NOT NULL AND "orderId" IS NULL)
  ),
  CONSTRAINT "tracking_order_reviews_quantity_check" CHECK ("actualTotalQuantity" >= 0 AND "activeBarcodeCount" >= 0)
);

CREATE UNIQUE INDEX "tracking_order_reviews_orderId_version_key" ON "tracking_order_reviews"("orderId", "version");
CREATE UNIQUE INDEX "tracking_order_reviews_groupId_version_key" ON "tracking_order_reviews"("groupId", "version");
CREATE INDEX "tracking_order_reviews_targetType_createdAt_idx" ON "tracking_order_reviews"("targetType", "createdAt" DESC);
CREATE INDEX "tracking_order_reviews_operatorId_idx" ON "tracking_order_reviews"("operatorId");
ALTER TABLE "tracking_order_reviews" ADD CONSTRAINT "tracking_order_reviews_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "tracking_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tracking_order_reviews" ADD CONSTRAINT "tracking_order_reviews_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "tracking_order_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tracking_order_reviews" ADD CONSTRAINT "tracking_order_reviews_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "tracking_order_review_items" (
  "id" UUID NOT NULL,
  "reviewId" UUID NOT NULL,
  "productCategoryId" UUID NOT NULL,
  "categoryName" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "tracking_order_review_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tracking_order_review_items_quantity_check" CHECK ("quantity" >= 0)
);

CREATE UNIQUE INDEX "tracking_order_review_items_reviewId_productCategoryId_key"
  ON "tracking_order_review_items"("reviewId", "productCategoryId");
CREATE INDEX "tracking_order_review_items_productCategoryId_idx" ON "tracking_order_review_items"("productCategoryId");
ALTER TABLE "tracking_order_review_items" ADD CONSTRAINT "tracking_order_review_items_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "tracking_order_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tracking_order_review_items" ADD CONSTRAINT "tracking_order_review_items_productCategoryId_fkey"
  FOREIGN KEY ("productCategoryId") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "tracking_order_corrections" (
  "id" UUID NOT NULL,
  "targetType" "TrackingCorrectionTargetType" NOT NULL,
  "orderId" UUID,
  "groupId" UUID,
  "beforeType" "TrackingOrderType" NOT NULL,
  "afterType" "TrackingOrderType" NOT NULL,
  "beforeSourceWarehouseId" UUID NOT NULL,
  "afterSourceWarehouseId" UUID NOT NULL,
  "beforeTargetWarehouseId" UUID,
  "afterTargetWarehouseId" UUID,
  "beforeSalespersonId" UUID,
  "afterSalespersonId" UUID,
  "note" TEXT,
  "operatorId" UUID,
  "operatorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracking_order_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tracking_order_corrections_target_check" CHECK (
    ("targetType" = 'ORDER' AND "orderId" IS NOT NULL AND "groupId" IS NULL) OR
    ("targetType" = 'GROUP' AND "groupId" IS NOT NULL AND "orderId" IS NULL)
  ),
  CONSTRAINT "tracking_order_corrections_outbound_only" CHECK ("beforeType" <> 'RETURN' AND "afterType" <> 'RETURN')
);

CREATE INDEX "tracking_order_corrections_orderId_createdAt_idx" ON "tracking_order_corrections"("orderId", "createdAt" DESC);
CREATE INDEX "tracking_order_corrections_groupId_createdAt_idx" ON "tracking_order_corrections"("groupId", "createdAt" DESC);
CREATE INDEX "tracking_order_corrections_operatorId_idx" ON "tracking_order_corrections"("operatorId");
ALTER TABLE "tracking_order_corrections" ADD CONSTRAINT "tracking_order_corrections_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "tracking_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tracking_order_corrections" ADD CONSTRAINT "tracking_order_corrections_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "tracking_order_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tracking_order_corrections" ADD CONSTRAINT "tracking_order_corrections_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing outbound orders predate the review workflow. Existing groups become formal historical totals.
UPDATE "tracking_orders" SET "reviewStatus" = 'EXEMPT';
UPDATE "tracking_order_groups" SET "reviewStatus" = 'EXEMPT';
UPDATE "tracking_orders" AS child
SET "status" = 'MERGED'
FROM "tracking_order_group_members" AS member
WHERE member."orderId" = child."id";

-- Qince categories are created only from successfully matched records.
INSERT INTO "product_categories" ("id", "name", "normalizedName", "status", "source", "createdAt", "updatedAt")
SELECT gen_random_uuid(), source."name", source."normalizedName", 'ENABLED', 'QINCE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (regexp_replace(btrim("externalGoodsName"), '[[:space:]]+', ' ', 'g'))
    regexp_replace(btrim("externalGoodsName"), '[[:space:]]+', ' ', 'g') AS "name",
    regexp_replace(btrim("externalGoodsName"), '[[:space:]]+', ' ', 'g') AS "normalizedName"
  FROM "terminal_receipt_records"
  WHERE "matchStatus" = 'MATCHED' AND length(btrim("externalGoodsName")) > 0
  ORDER BY regexp_replace(btrim("externalGoodsName"), '[[:space:]]+', ' ', 'g'), "createdAt" ASC
) AS source
ON CONFLICT ("normalizedName") DO NOTHING;

UPDATE "terminal_receipt_records" AS receipt
SET "productCategoryId" = category."id"
FROM "product_categories" AS category
WHERE receipt."matchStatus" = 'MATCHED'
  AND regexp_replace(btrim(receipt."externalGoodsName"), '[[:space:]]+', ' ', 'g') = category."normalizedName";

UPDATE "tracked_barcodes" AS item
SET "productCategoryId" = matched_receipt."productCategoryId"
FROM (
  SELECT DISTINCT ON (receipt."trackedBarcodeId")
    receipt."trackedBarcodeId",
    receipt."productCategoryId"
  FROM "terminal_receipt_records" AS receipt
  WHERE receipt."matchStatus" = 'MATCHED'
    AND receipt."trackedBarcodeId" IS NOT NULL
    AND receipt."productCategoryId" IS NOT NULL
  ORDER BY receipt."trackedBarcodeId", receipt."scannedAt" DESC, receipt."createdAt" DESC, receipt."id" DESC
) AS matched_receipt
WHERE item."id" = matched_receipt."trackedBarcodeId";
