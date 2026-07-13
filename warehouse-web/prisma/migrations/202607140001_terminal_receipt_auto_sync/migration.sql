CREATE TYPE "TerminalReceiptSyncTrigger" AS ENUM ('MANUAL', 'SCHEDULED');
CREATE TYPE "TerminalReceiptSyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILURE');

CREATE TABLE "terminal_receipt_sync_runs" (
    "id" UUID NOT NULL,
    "trigger" "TerminalReceiptSyncTrigger" NOT NULL,
    "status" "TerminalReceiptSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "logicalStartAt" TIMESTAMP(3) NOT NULL,
    "logicalEndAt" TIMESTAMP(3) NOT NULL,
    "exportStartDate" DATE NOT NULL,
    "exportEndDate" DATE NOT NULL,
    "externalTaskKey" TEXT,
    "externalFileName" TEXT,
    "importId" UUID,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "matchedRows" INTEGER NOT NULL DEFAULT 0,
    "unmatchedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "operatorName" TEXT NOT NULL,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terminal_receipt_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "terminal_receipt_sync_runs_status_startedAt_idx"
  ON "terminal_receipt_sync_runs"("status", "startedAt" DESC);
CREATE INDEX "terminal_receipt_sync_runs_logicalEndAt_idx"
  ON "terminal_receipt_sync_runs"("logicalEndAt" DESC);
CREATE INDEX "terminal_receipt_sync_runs_createdAt_idx"
  ON "terminal_receipt_sync_runs"("createdAt" DESC);

-- Only one scheduled or manual synchronization may be active at a time.
CREATE UNIQUE INDEX "terminal_receipt_sync_runs_single_running_idx"
  ON "terminal_receipt_sync_runs" ((1))
  WHERE "status" = 'RUNNING';

ALTER TABLE "terminal_receipt_sync_runs"
ADD CONSTRAINT "terminal_receipt_sync_runs_importId_fkey"
FOREIGN KEY ("importId") REFERENCES "terminal_receipt_imports"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
