ALTER TABLE "terminal_receipt_imports"
  ADD COLUMN "conflictRows" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "terminal_receipt_sync_runs"
  ADD COLUMN "conflictRows" INTEGER NOT NULL DEFAULT 0;

UPDATE "terminal_receipt_imports" AS import_batch
SET "conflictRows" = conflict_counts."count"
FROM (
  SELECT "importId", COUNT(*)::INTEGER AS "count"
  FROM "terminal_receipt_records"
  WHERE "matchStatus" = 'CONFLICT'
  GROUP BY "importId"
) AS conflict_counts
WHERE import_batch."id" = conflict_counts."importId";

UPDATE "terminal_receipt_sync_runs" AS sync_run
SET "conflictRows" = import_batch."conflictRows"
FROM "terminal_receipt_imports" AS import_batch
WHERE sync_run."importId" = import_batch."id";
