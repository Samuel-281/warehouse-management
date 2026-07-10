ALTER TYPE "InboundSource" ADD VALUE IF NOT EXISTS 'OUTBOUND_SCAN';

WITH first_movements AS (
  SELECT DISTINCT ON ("itemId")
    "itemId",
    type
  FROM "stock_movements"
  ORDER BY "itemId", "occurredAt" ASC
)
UPDATE "inventory_items" AS item
SET "inboundSource" = 'OUTBOUND_SCAN'
FROM first_movements
WHERE first_movements."itemId" = item.id
  AND first_movements.type IN ('TRANSFER', 'SALES_OUTBOUND')
  AND item."inboundSource" = 'FACTORY';

DROP INDEX IF EXISTS "stock_movements_barcode_idx";
DROP INDEX IF EXISTS "stock_movements_itemId_idx";
DROP INDEX IF EXISTS "stock_movements_barcode_occurredAt_idx";

CREATE INDEX "stock_movements_barcode_occurredAt_idx"
  ON "stock_movements"("barcode", "occurredAt" DESC);
CREATE INDEX "stock_movements_itemId_occurredAt_idx"
  ON "stock_movements"("itemId", "occurredAt" DESC);
