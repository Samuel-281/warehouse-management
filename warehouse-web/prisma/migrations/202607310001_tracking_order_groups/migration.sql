-- A group is a reporting layer over immutable sales outbound orders.
-- It does not create movements or change barcode ownership.
CREATE TABLE "tracking_order_groups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "groupNo" TEXT NOT NULL,
  "sourceWarehouseId" UUID NOT NULL,
  "salespersonId" UUID NOT NULL,
  "operatorId" UUID,
  "operatorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracking_order_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tracking_order_group_members" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "groupId" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracking_order_group_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tracking_order_groups_groupNo_key" ON "tracking_order_groups"("groupNo");
CREATE INDEX "tracking_order_groups_createdAt_idx" ON "tracking_order_groups"("createdAt" DESC);
CREATE INDEX "tracking_order_groups_sourceWarehouseId_salespersonId_createdAt_idx" ON "tracking_order_groups"("sourceWarehouseId", "salespersonId", "createdAt" DESC);
CREATE UNIQUE INDEX "tracking_order_group_members_orderId_key" ON "tracking_order_group_members"("orderId");
CREATE UNIQUE INDEX "tracking_order_group_members_groupId_orderId_key" ON "tracking_order_group_members"("groupId", "orderId");
CREATE INDEX "tracking_order_group_members_groupId_idx" ON "tracking_order_group_members"("groupId");

ALTER TABLE "tracking_order_groups" ADD CONSTRAINT "tracking_order_groups_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tracking_order_groups" ADD CONSTRAINT "tracking_order_groups_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salespeople"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tracking_order_groups" ADD CONSTRAINT "tracking_order_groups_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tracking_order_group_members" ADD CONSTRAINT "tracking_order_group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "tracking_order_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tracking_order_group_members" ADD CONSTRAINT "tracking_order_group_members_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "tracking_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
