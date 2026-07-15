UPDATE "terminal_receipt_records" AS receipt
SET "matchStatus" = CASE
  WHEN (
    SELECT movement."type"::TEXT
    FROM "stock_movements" AS movement
    WHERE movement."itemId" = receipt."inventoryItemId"
      AND movement."occurredAt" <= receipt."scannedAt"
    ORDER BY movement."occurredAt" DESC, movement."id" DESC
    LIMIT 1
  ) = 'SALES_OUTBOUND'
  THEN 'MATCHED'::"ReceiptMatchStatus"
  ELSE 'CONFLICT'::"ReceiptMatchStatus"
END
WHERE receipt."inventoryItemId" IS NOT NULL;

WITH signed_items AS (
  SELECT
    item."id" AS "itemId",
    receipt."receivingOrganizationName" AS "terminalStoreName",
    receipt."scannedAt" AS "signedAt"
  FROM "inventory_items" AS item
  JOIN LATERAL (
    SELECT movement."type", movement."occurredAt"
    FROM "stock_movements" AS movement
    WHERE movement."itemId" = item."id"
    ORDER BY movement."occurredAt" DESC, movement."id" DESC
    LIMIT 1
  ) AS latest_movement ON TRUE
  JOIN LATERAL (
    SELECT receipt."receivingOrganizationName", receipt."scannedAt"
    FROM "terminal_receipt_records" AS receipt
    WHERE receipt."inventoryItemId" = item."id"
      AND receipt."matchStatus" = 'MATCHED'
    ORDER BY receipt."scannedAt" DESC, receipt."createdAt" DESC
    LIMIT 1
  ) AS receipt ON TRUE
  WHERE latest_movement."type" = 'SALES_OUTBOUND'
    AND receipt."scannedAt" >= latest_movement."occurredAt"
)
UPDATE "inventory_items" AS item
SET
  "ownerType" = 'TERMINAL_STORE',
  "warehouseId" = NULL,
  "locationId" = NULL,
  "salespersonId" = NULL,
  "terminalStoreName" = signed_items."terminalStoreName",
  "signedAt" = signed_items."signedAt",
  "status" = 'SIGNED',
  "lastMovedAt" = signed_items."signedAt"
FROM signed_items
WHERE item."id" = signed_items."itemId";
