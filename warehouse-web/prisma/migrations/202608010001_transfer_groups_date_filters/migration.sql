-- Extend reporting-only order groups to cover warehouse transfers as well as sales outbound.
-- Existing groups are sales outbound groups and retain their current salesperson route.
ALTER TABLE "tracking_order_groups"
  ADD COLUMN "type" "TrackingOrderType" NOT NULL DEFAULT 'SALES_OUTBOUND',
  ADD COLUMN "targetWarehouseId" UUID,
  ALTER COLUMN "salespersonId" DROP NOT NULL;

ALTER TABLE "tracking_order_groups"
  ALTER COLUMN "type" DROP DEFAULT;

ALTER TABLE "tracking_order_groups"
  ADD CONSTRAINT "tracking_order_groups_targetWarehouseId_fkey"
  FOREIGN KEY ("targetWarehouseId") REFERENCES "warehouses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tracking_order_groups"
  ADD CONSTRAINT "tracking_order_groups_route_consistency" CHECK (
    (
      "type" = 'SALES_OUTBOUND'
      AND "salespersonId" IS NOT NULL
      AND "targetWarehouseId" IS NULL
    )
    OR
    (
      "type" = 'TRANSFER'
      AND "salespersonId" IS NULL
      AND "targetWarehouseId" IS NOT NULL
    )
  );

DROP INDEX "tracking_order_groups_sourceWarehouseId_salespersonId_createdAt_idx";
CREATE INDEX "tracking_order_groups_type_createdAt_idx"
  ON "tracking_order_groups"("type", "createdAt" DESC);
CREATE INDEX "tracking_order_groups_sourceWarehouseId_salespersonId_createdAt_idx"
  ON "tracking_order_groups"("sourceWarehouseId", "salespersonId", "createdAt" DESC);
CREATE INDEX "tracking_order_groups_sourceWarehouseId_targetWarehouseId_createdAt_idx"
  ON "tracking_order_groups"("sourceWarehouseId", "targetWarehouseId", "createdAt" DESC);

-- Date-only order filtering also needs an efficient path when no business type is selected.
CREATE INDEX "tracking_orders_createdAt_idx"
  ON "tracking_orders"("createdAt" DESC);
