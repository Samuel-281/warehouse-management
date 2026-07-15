ALTER TABLE "inventory_items"
  DROP CONSTRAINT IF EXISTS "inventory_items_owner_consistency";

ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_owner_consistency" CHECK (
    (
      "ownerType" = 'WAREHOUSE'
      AND "warehouseId" IS NOT NULL
      AND "salespersonId" IS NULL
      AND "terminalStoreName" IS NULL
      AND "signedAt" IS NULL
    )
    OR
    (
      "ownerType" = 'SALESPERSON'
      AND "salespersonId" IS NOT NULL
      AND "warehouseId" IS NULL
      AND "locationId" IS NULL
      AND "terminalStoreName" IS NULL
      AND "signedAt" IS NULL
    )
    OR
    (
      "ownerType" = 'TERMINAL_STORE'
      AND "warehouseId" IS NULL
      AND "locationId" IS NULL
      AND "salespersonId" IS NULL
      AND "terminalStoreName" IS NOT NULL
      AND "signedAt" IS NOT NULL
    )
  );
