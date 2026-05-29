-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "GoodsCategory" AS ENUM ('HEALTH_WINE', 'BAIJIU');

-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('MAIN', 'BRANCH');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ENABLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "OwnerType" AS ENUM ('WAREHOUSE', 'SALESPERSON');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('IN_STOCK', 'WITH_SALESPERSON');

-- CreateEnum
CREATE TYPE "InboundSource" AS ENUM ('FACTORY', 'TERMINAL_RETURN');

-- CreateEnum
CREATE TYPE "OutboundType" AS ENUM ('TRANSFER', 'SALES');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('FACTORY_INBOUND', 'TERMINAL_RETURN_INBOUND', 'TRANSFER', 'SALES_OUTBOUND', 'SALES_RETURN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "GoodsCategory" NOT NULL,
    "unit" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WarehouseType" NOT NULL,
    "parentId" UUID,
    "manager" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_locations" (
    "id" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "zone" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salespeople" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salespeople_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_stores" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminal_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "goodsId" UUID NOT NULL,
    "ownerType" "OwnerType" NOT NULL,
    "warehouseId" UUID,
    "locationId" UUID,
    "salespersonId" UUID,
    "status" "ItemStatus" NOT NULL,
    "productionDate" DATE,
    "shelfLifeDate" DATE,
    "inboundSource" "InboundSource" NOT NULL,
    "lastMovedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "goodsId" UUID NOT NULL,
    "type" "MovementType" NOT NULL,
    "fromLabel" TEXT NOT NULL,
    "toLabel" TEXT NOT NULL,
    "operatorId" UUID,
    "operatorName" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_orders" (
    "id" UUID NOT NULL,
    "orderNo" TEXT NOT NULL,
    "source" "InboundSource" NOT NULL,
    "warehouseId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "terminalStoreId" UUID,
    "operatorId" UUID,
    "operatorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_order_items" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "goodsId" UUID NOT NULL,
    "productionDate" DATE,
    "shelfLifeDate" DATE,

    CONSTRAINT "inbound_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_orders" (
    "id" UUID NOT NULL,
    "orderNo" TEXT NOT NULL,
    "type" "OutboundType" NOT NULL,
    "sourceWarehouseId" UUID NOT NULL,
    "targetWarehouseId" UUID,
    "targetLocationId" UUID,
    "salespersonId" UUID,
    "operatorId" UUID,
    "operatorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_order_items" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "goodsId" UUID NOT NULL,

    CONSTRAINT "outbound_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return_orders" (
    "id" UUID NOT NULL,
    "orderNo" TEXT NOT NULL,
    "returnWarehouseId" UUID NOT NULL,
    "returnLocationId" UUID NOT NULL,
    "operatorId" UUID,
    "operatorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_return_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return_order_items" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "goodsId" UUID NOT NULL,
    "fromSalespersonId" UUID NOT NULL,

    CONSTRAINT "sales_return_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "user_roles"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "goods_code_key" ON "goods"("code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE INDEX "warehouses_parentId_idx" ON "warehouses"("parentId");

-- CreateIndex
CREATE INDEX "storage_locations_warehouseId_idx" ON "storage_locations"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_warehouseId_code_key" ON "storage_locations"("warehouseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "salespeople_code_key" ON "salespeople"("code");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_barcode_key" ON "inventory_items"("barcode");

-- CreateIndex
CREATE INDEX "inventory_items_goodsId_idx" ON "inventory_items"("goodsId");

-- CreateIndex
CREATE INDEX "inventory_items_warehouseId_idx" ON "inventory_items"("warehouseId");

-- CreateIndex
CREATE INDEX "inventory_items_salespersonId_idx" ON "inventory_items"("salespersonId");

-- CreateIndex
CREATE INDEX "inventory_items_lastMovedAt_idx" ON "inventory_items"("lastMovedAt");

-- CreateIndex
CREATE INDEX "stock_movements_barcode_idx" ON "stock_movements"("barcode");

-- CreateIndex
CREATE INDEX "stock_movements_itemId_idx" ON "stock_movements"("itemId");

-- CreateIndex
CREATE INDEX "stock_movements_goodsId_idx" ON "stock_movements"("goodsId");

-- CreateIndex
CREATE INDEX "stock_movements_occurredAt_idx" ON "stock_movements"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_orders_orderNo_key" ON "inbound_orders"("orderNo");

-- CreateIndex
CREATE INDEX "inbound_orders_source_idx" ON "inbound_orders"("source");

-- CreateIndex
CREATE INDEX "inbound_orders_warehouseId_idx" ON "inbound_orders"("warehouseId");

-- CreateIndex
CREATE INDEX "inbound_orders_createdAt_idx" ON "inbound_orders"("createdAt");

-- CreateIndex
CREATE INDEX "inbound_order_items_barcode_idx" ON "inbound_order_items"("barcode");

-- CreateIndex
CREATE INDEX "inbound_order_items_goodsId_idx" ON "inbound_order_items"("goodsId");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_orders_orderNo_key" ON "outbound_orders"("orderNo");

-- CreateIndex
CREATE INDEX "outbound_orders_type_idx" ON "outbound_orders"("type");

-- CreateIndex
CREATE INDEX "outbound_orders_sourceWarehouseId_idx" ON "outbound_orders"("sourceWarehouseId");

-- CreateIndex
CREATE INDEX "outbound_orders_targetWarehouseId_idx" ON "outbound_orders"("targetWarehouseId");

-- CreateIndex
CREATE INDEX "outbound_orders_salespersonId_idx" ON "outbound_orders"("salespersonId");

-- CreateIndex
CREATE INDEX "outbound_orders_createdAt_idx" ON "outbound_orders"("createdAt");

-- CreateIndex
CREATE INDEX "outbound_order_items_barcode_idx" ON "outbound_order_items"("barcode");

-- CreateIndex
CREATE INDEX "outbound_order_items_goodsId_idx" ON "outbound_order_items"("goodsId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_return_orders_orderNo_key" ON "sales_return_orders"("orderNo");

-- CreateIndex
CREATE INDEX "sales_return_orders_returnWarehouseId_idx" ON "sales_return_orders"("returnWarehouseId");

-- CreateIndex
CREATE INDEX "sales_return_orders_createdAt_idx" ON "sales_return_orders"("createdAt");

-- CreateIndex
CREATE INDEX "sales_return_order_items_barcode_idx" ON "sales_return_order_items"("barcode");

-- CreateIndex
CREATE INDEX "sales_return_order_items_goodsId_idx" ON "sales_return_order_items"("goodsId");

-- CreateIndex
CREATE INDEX "sales_return_order_items_fromSalespersonId_idx" ON "sales_return_order_items"("fromSalespersonId");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_goodsId_fkey" FOREIGN KEY ("goodsId") REFERENCES "goods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salespeople"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_goodsId_fkey" FOREIGN KEY ("goodsId") REFERENCES "goods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_orders" ADD CONSTRAINT "inbound_orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_orders" ADD CONSTRAINT "inbound_orders_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_orders" ADD CONSTRAINT "inbound_orders_terminalStoreId_fkey" FOREIGN KEY ("terminalStoreId") REFERENCES "terminal_stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_orders" ADD CONSTRAINT "inbound_orders_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_order_items" ADD CONSTRAINT "inbound_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "inbound_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_order_items" ADD CONSTRAINT "inbound_order_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_order_items" ADD CONSTRAINT "inbound_order_items_goodsId_fkey" FOREIGN KEY ("goodsId") REFERENCES "goods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_orders" ADD CONSTRAINT "outbound_orders_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_orders" ADD CONSTRAINT "outbound_orders_targetWarehouseId_fkey" FOREIGN KEY ("targetWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_orders" ADD CONSTRAINT "outbound_orders_targetLocationId_fkey" FOREIGN KEY ("targetLocationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_orders" ADD CONSTRAINT "outbound_orders_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salespeople"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_orders" ADD CONSTRAINT "outbound_orders_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_order_items" ADD CONSTRAINT "outbound_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "outbound_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_order_items" ADD CONSTRAINT "outbound_order_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_order_items" ADD CONSTRAINT "outbound_order_items_goodsId_fkey" FOREIGN KEY ("goodsId") REFERENCES "goods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_orders" ADD CONSTRAINT "sales_return_orders_returnWarehouseId_fkey" FOREIGN KEY ("returnWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_orders" ADD CONSTRAINT "sales_return_orders_returnLocationId_fkey" FOREIGN KEY ("returnLocationId") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_orders" ADD CONSTRAINT "sales_return_orders_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_order_items" ADD CONSTRAINT "sales_return_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sales_return_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_order_items" ADD CONSTRAINT "sales_return_order_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_order_items" ADD CONSTRAINT "sales_return_order_items_goodsId_fkey" FOREIGN KEY ("goodsId") REFERENCES "goods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_order_items" ADD CONSTRAINT "sales_return_order_items_fromSalespersonId_fkey" FOREIGN KEY ("fromSalespersonId") REFERENCES "salespeople"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
