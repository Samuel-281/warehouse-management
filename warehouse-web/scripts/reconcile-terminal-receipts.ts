import { reconcileTrackedReceiptConflicts } from "@/lib/services/terminal-receipt-ownership-service";

async function main() {
  const result = await reconcileTrackedReceiptConflicts();
  console.log(
    `[terminal-receipt-reconcile] reviewedBarcodes=${result.reviewedBarcodes};reviewedRows=${result.reviewedRows};resolvedRows=${result.resolvedRows};remainingConflicts=${result.remainingConflictRows};updatedImports=${result.updatedImports}`
  );
}

void main();
