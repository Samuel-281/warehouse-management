-- Qince is authoritative for the product attached to a tracked barcode.
-- Legacy local goods names were often abbreviations and must not create receipt conflicts.
WITH receipt_events AS (
  SELECT
    receipt."id",
    receipt."trackedBarcodeId",
    receipt."externalGoodsName",
    receipt."scannedAt",
    receipt."createdAt"
  FROM "terminal_receipt_records" receipt
  JOIN "tracking_movements" movement
    ON movement."receiptRecordId" = receipt."id"
   AND movement."type" = 'QINCE_RECEIPT'
  WHERE receipt."trackedBarcodeId" IS NOT NULL
),
canonical AS (
  SELECT DISTINCT ON (event."trackedBarcodeId")
    event."trackedBarcodeId",
    BTRIM(event."externalGoodsName") AS "externalGoodsName"
  FROM receipt_events event
  ORDER BY event."trackedBarcodeId", event."scannedAt", event."createdAt", event."id"
)
UPDATE "terminal_receipt_records" receipt
SET "matchStatus" = CASE
  WHEN BTRIM(receipt."externalGoodsName") = canonical."externalGoodsName"
    THEN 'MATCHED'::"ReceiptMatchStatus"
  ELSE 'CONFLICT'::"ReceiptMatchStatus"
END
FROM canonical
WHERE receipt."trackedBarcodeId" = canonical."trackedBarcodeId"
  AND EXISTS (
    SELECT 1
    FROM "tracking_movements" movement
    WHERE movement."receiptRecordId" = receipt."id"
      AND movement."type" = 'QINCE_RECEIPT'
  );

WITH receipt_events AS (
  SELECT
    receipt."id",
    receipt."trackedBarcodeId",
    receipt."externalGoodsName",
    receipt."goodsUnit",
    receipt."scannedAt",
    receipt."createdAt"
  FROM "terminal_receipt_records" receipt
  JOIN "tracking_movements" movement
    ON movement."receiptRecordId" = receipt."id"
   AND movement."type" = 'QINCE_RECEIPT'
  WHERE receipt."trackedBarcodeId" IS NOT NULL
),
canonical AS (
  SELECT DISTINCT ON (event."trackedBarcodeId")
    event."trackedBarcodeId",
    event."externalGoodsName",
    event."goodsUnit"
  FROM receipt_events event
  ORDER BY event."trackedBarcodeId", event."scannedAt", event."createdAt", event."id"
),
conflicts AS (
  SELECT
    event."trackedBarcodeId",
    BOOL_OR(BTRIM(event."externalGoodsName") <> BTRIM(canonical."externalGoodsName")) AS "hasConflict"
  FROM receipt_events event
  JOIN canonical ON canonical."trackedBarcodeId" = event."trackedBarcodeId"
  GROUP BY event."trackedBarcodeId"
),
latest_movements AS (
  SELECT DISTINCT ON (movement."trackedBarcodeId")
    movement."trackedBarcodeId",
    movement."type"
  FROM "tracking_movements" movement
  ORDER BY movement."trackedBarcodeId", movement."occurredAt" DESC, movement."id" DESC
)
UPDATE "tracked_barcodes" tracked
SET
  "externalGoodsName" = canonical."externalGoodsName",
  "goodsUnit" = canonical."goodsUnit",
  "receiptStatus" = CASE
    WHEN latest_movements."type" = 'SALES_OUTBOUND'
      THEN 'PENDING'::"TrackingReceiptStatus"
    WHEN COALESCE(conflicts."hasConflict", false)
      THEN 'EXCEPTION'::"TrackingReceiptStatus"
    ELSE 'SIGNED'::"TrackingReceiptStatus"
  END
FROM canonical
LEFT JOIN conflicts ON conflicts."trackedBarcodeId" = canonical."trackedBarcodeId"
LEFT JOIN latest_movements ON latest_movements."trackedBarcodeId" = canonical."trackedBarcodeId"
WHERE tracked."id" = canonical."trackedBarcodeId";
