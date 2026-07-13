CREATE TYPE "ReceiptMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED');

CREATE TABLE "terminal_receipt_imports" (
    "id" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "importedRows" INTEGER NOT NULL,
    "matchedRows" INTEGER NOT NULL,
    "unmatchedRows" INTEGER NOT NULL,
    "duplicateRows" INTEGER NOT NULL,
    "invalidRows" INTEGER NOT NULL,
    "operatorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terminal_receipt_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "terminal_receipt_records" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "inventoryItemId" UUID,
    "barcode" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL,
    "scannerName" TEXT NOT NULL,
    "externalGoodsName" TEXT NOT NULL,
    "goodsUnit" TEXT NOT NULL,
    "receivingOrganizationName" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "matchStatus" "ReceiptMatchStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terminal_receipt_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "terminal_receipt_imports_fileHash_key" ON "terminal_receipt_imports"("fileHash");
CREATE INDEX "terminal_receipt_imports_createdAt_idx" ON "terminal_receipt_imports"("createdAt");
CREATE UNIQUE INDEX "terminal_receipt_records_fingerprint_key" ON "terminal_receipt_records"("fingerprint");
CREATE INDEX "terminal_receipt_records_barcode_scannedAt_idx" ON "terminal_receipt_records"("barcode", "scannedAt" DESC);
CREATE INDEX "terminal_receipt_records_inventoryItemId_scannedAt_idx" ON "terminal_receipt_records"("inventoryItemId", "scannedAt" DESC);
CREATE INDEX "terminal_receipt_records_receivingOrganizationName_idx" ON "terminal_receipt_records"("receivingOrganizationName");
CREATE INDEX "terminal_receipt_records_importId_idx" ON "terminal_receipt_records"("importId");

ALTER TABLE "terminal_receipt_records"
ADD CONSTRAINT "terminal_receipt_records_importId_fkey"
FOREIGN KEY ("importId") REFERENCES "terminal_receipt_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "terminal_receipt_records"
ADD CONSTRAINT "terminal_receipt_records_inventoryItemId_fkey"
FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
