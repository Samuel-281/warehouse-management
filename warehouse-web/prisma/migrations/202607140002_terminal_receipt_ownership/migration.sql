ALTER TYPE "OwnerType" ADD VALUE IF NOT EXISTS 'TERMINAL_STORE';
ALTER TYPE "ItemStatus" ADD VALUE IF NOT EXISTS 'SIGNED';
ALTER TYPE "ItemStatus" ADD VALUE IF NOT EXISTS 'RECEIPT_EXCEPTION';
ALTER TYPE "ReceiptMatchStatus" ADD VALUE IF NOT EXISTS 'CONFLICT';

ALTER TABLE "inventory_items"
  ADD COLUMN "terminalStoreName" TEXT,
  ADD COLUMN "signedAt" TIMESTAMP(3);

ALTER TABLE "inbound_order_items"
  ADD COLUMN "beforeTerminalStoreName" TEXT,
  ADD COLUMN "beforeSignedAt" TIMESTAMP(3);

ALTER TABLE "outbound_order_items"
  ADD COLUMN "beforeTerminalStoreName" TEXT,
  ADD COLUMN "beforeSignedAt" TIMESTAMP(3);

ALTER TABLE "sales_return_order_items"
  ADD COLUMN "beforeTerminalStoreName" TEXT,
  ADD COLUMN "beforeSignedAt" TIMESTAMP(3);

CREATE INDEX "inventory_items_ownerType_terminalStoreName_lastMovedAt_idx"
  ON "inventory_items"("ownerType", "terminalStoreName", "lastMovedAt");
CREATE INDEX "inventory_items_status_lastMovedAt_idx"
  ON "inventory_items"("status", "lastMovedAt");
