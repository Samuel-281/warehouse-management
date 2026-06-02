CREATE INDEX IF NOT EXISTS "inventory_items_ownerType_warehouseId_lastMovedAt_idx"
  ON "inventory_items" ("ownerType", "warehouseId", "lastMovedAt");

CREATE INDEX IF NOT EXISTS "inventory_items_ownerType_salespersonId_lastMovedAt_idx"
  ON "inventory_items" ("ownerType", "salespersonId", "lastMovedAt");

CREATE INDEX IF NOT EXISTS "inventory_items_goodsId_lastMovedAt_idx"
  ON "inventory_items" ("goodsId", "lastMovedAt");

CREATE INDEX IF NOT EXISTS "stock_movements_barcode_occurredAt_idx"
  ON "stock_movements" ("barcode", "occurredAt");
