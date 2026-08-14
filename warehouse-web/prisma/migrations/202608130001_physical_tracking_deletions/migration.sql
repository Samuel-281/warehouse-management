CREATE TEMP TABLE "_voided_tracking_groups" AS
SELECT id
FROM "tracking_order_groups"
WHERE status = 'VOIDED';

CREATE TEMP TABLE "_voided_tracking_orders" AS
SELECT id
FROM "tracking_orders"
WHERE status = 'VOIDED'
UNION
SELECT member."orderId"
FROM "tracking_order_group_members" AS member
JOIN "_voided_tracking_groups" AS target_group ON target_group.id = member."groupId";

CREATE TEMP TABLE "_deletable_voided_barcodes" AS
SELECT barcode.id
FROM "tracked_barcodes" AS barcode
WHERE barcode.status = 'VOIDED'
  AND NOT EXISTS (
    SELECT 1
    FROM "terminal_receipt_records" AS receipt
    WHERE receipt.barcode = barcode.barcode
  );

CREATE TEMP TABLE "_affected_tracking_orders" AS
SELECT id FROM "_voided_tracking_orders"
UNION
SELECT DISTINCT item."orderId"
FROM "tracking_order_barcodes" AS item
JOIN "_deletable_voided_barcodes" AS barcode ON barcode.id = item."trackedBarcodeId";

CREATE TEMP TABLE "_affected_tracking_groups" AS
SELECT id FROM "_voided_tracking_groups"
UNION
SELECT DISTINCT member."groupId"
FROM "tracking_order_group_members" AS member
JOIN "_affected_tracking_orders" AS target_order ON target_order.id = member."orderId";

CREATE TEMP TABLE "_affected_barcodes" AS
SELECT DISTINCT item."trackedBarcodeId" AS id
FROM "tracking_order_barcodes" AS item
JOIN "_affected_tracking_orders" AS target_order ON target_order.id = item."orderId"
UNION
SELECT id FROM "_deletable_voided_barcodes";

DELETE FROM "tracking_movements"
WHERE "trackedBarcodeId" IN (SELECT id FROM "_deletable_voided_barcodes")
   OR "orderId" IN (SELECT id FROM "_voided_tracking_orders")
   OR "groupId" IN (SELECT id FROM "_voided_tracking_groups");

DELETE FROM "tracking_order_barcodes"
WHERE "trackedBarcodeId" IN (SELECT id FROM "_deletable_voided_barcodes");

CREATE TEMP TABLE "_empty_tracking_orders" AS
SELECT id FROM "_voided_tracking_orders"
UNION
SELECT target_order.id
FROM "_affected_tracking_orders" AS target_order
WHERE NOT EXISTS (
  SELECT 1
  FROM "tracking_order_barcodes" AS item
  WHERE item."orderId" = target_order.id
);

CREATE TEMP TABLE "_groups_to_delete" AS
SELECT id FROM "_voided_tracking_groups"
UNION
SELECT target_group.id
FROM "_affected_tracking_groups" AS target_group
WHERE (
  SELECT COUNT(*)
  FROM "tracking_order_group_members" AS member
  WHERE member."groupId" = target_group.id
    AND member."orderId" NOT IN (SELECT id FROM "_empty_tracking_orders")
) <= 1;

CREATE TEMP TABLE "_remaining_dissolved_orders" AS
SELECT DISTINCT member."orderId" AS id
FROM "tracking_order_group_members" AS member
JOIN "_groups_to_delete" AS target_group ON target_group.id = member."groupId"
WHERE member."orderId" NOT IN (SELECT id FROM "_empty_tracking_orders");

DELETE FROM "tracking_order_review_items"
WHERE "reviewId" IN (
  SELECT id
  FROM "tracking_order_reviews"
  WHERE "orderId" IN (SELECT id FROM "_empty_tracking_orders")
     OR "groupId" IN (SELECT id FROM "_groups_to_delete")
);

DELETE FROM "tracking_order_reviews"
WHERE "orderId" IN (SELECT id FROM "_empty_tracking_orders")
   OR "groupId" IN (SELECT id FROM "_groups_to_delete");

DELETE FROM "tracking_order_corrections"
WHERE "orderId" IN (SELECT id FROM "_empty_tracking_orders")
   OR "groupId" IN (SELECT id FROM "_groups_to_delete");

DELETE FROM "tracking_movements"
WHERE "orderId" IN (SELECT id FROM "_empty_tracking_orders")
   OR "groupId" IN (SELECT id FROM "_groups_to_delete");

UPDATE "tracked_barcodes" AS barcode
SET "lastMovedAt" = COALESCE(
  (
    SELECT MAX(movement."occurredAt")
    FROM "tracking_movements" AS movement
    WHERE movement."trackedBarcodeId" = barcode.id
  ),
  barcode."createdAt"
)
WHERE barcode.id IN (SELECT id FROM "_affected_barcodes")
  AND barcode.id NOT IN (SELECT id FROM "_deletable_voided_barcodes");

UPDATE "tracking_orders"
SET "correctedAfterReview" = TRUE
WHERE id IN (SELECT id FROM "_affected_tracking_orders")
  AND id NOT IN (SELECT id FROM "_empty_tracking_orders")
  AND "reviewStatus" = 'REVIEWED';

UPDATE "tracking_order_groups"
SET "correctedAfterReview" = TRUE
WHERE id IN (SELECT id FROM "_affected_tracking_groups")
  AND id NOT IN (SELECT id FROM "_groups_to_delete")
  AND "reviewStatus" = 'REVIEWED';

DELETE FROM "tracking_order_group_members"
WHERE "orderId" IN (SELECT id FROM "_empty_tracking_orders");

DELETE FROM "tracking_order_groups"
WHERE id IN (SELECT id FROM "_groups_to_delete");

UPDATE "tracking_orders"
SET status = 'ACTIVE'
WHERE id IN (SELECT id FROM "_remaining_dissolved_orders")
  AND status = 'MERGED';

DELETE FROM "tracking_orders"
WHERE id IN (SELECT id FROM "_empty_tracking_orders");

DELETE FROM "tracked_barcodes"
WHERE id IN (SELECT id FROM "_deletable_voided_barcodes");

DROP TABLE "_remaining_dissolved_orders";
DROP TABLE "_groups_to_delete";
DROP TABLE "_empty_tracking_orders";
DROP TABLE "_affected_barcodes";
DROP TABLE "_affected_tracking_groups";
DROP TABLE "_affected_tracking_orders";
DROP TABLE "_deletable_voided_barcodes";
DROP TABLE "_voided_tracking_orders";
DROP TABLE "_voided_tracking_groups";
