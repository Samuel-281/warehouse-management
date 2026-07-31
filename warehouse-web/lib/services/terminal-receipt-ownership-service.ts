import { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/db";

type DbClient = Prisma.TransactionClient;
const RECONCILIATION_BATCH_SIZE = 100;

export function canTerminalReceiptFollow(movementType?: string | null) {
  return movementType === "SALES_OUTBOUND" || movementType === "TRANSFER" || movementType === "QINCE_RECEIPT";
}

export async function reconcileTerminalReceiptOwnership(
  tx: DbClient,
  inventoryItemIds: string[]
) {
  const uniqueIds = Array.from(new Set(inventoryItemIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  const items = await tx.inventoryItem.findMany({
    where: { id: { in: uniqueIds } },
    include: {
      stockMovements: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] },
      terminalReceiptRecords: { orderBy: [{ scannedAt: "asc" }, { createdAt: "asc" }] }
    }
  });

  for (const item of items) {
    const matchedReceiptIds: string[] = [];
    const conflictReceiptIds: string[] = [];

    for (const receipt of item.terminalReceiptRecords) {
      const precedingMovement = [...item.stockMovements]
        .reverse()
        .find((movement) => movement.occurredAt.getTime() <= receipt.scannedAt.getTime());

      if (precedingMovement?.type === "SALES_OUTBOUND") {
        matchedReceiptIds.push(receipt.id);
      } else {
        conflictReceiptIds.push(receipt.id);
      }
    }

    if (matchedReceiptIds.length > 0) {
      await tx.terminalReceiptRecord.updateMany({
        where: { id: { in: matchedReceiptIds } },
        data: { matchStatus: "MATCHED" }
      });
    }
    if (conflictReceiptIds.length > 0) {
      await tx.terminalReceiptRecord.updateMany({
        where: { id: { in: conflictReceiptIds } },
        data: { matchStatus: "CONFLICT" }
      });
    }

    const latestMovement = item.stockMovements.at(-1);
    const latestMatchedReceipt = item.terminalReceiptRecords
      .filter((receipt) => matchedReceiptIds.includes(receipt.id))
      .at(-1);

    if (
      latestMovement?.type === "SALES_OUTBOUND" &&
      latestMatchedReceipt &&
      latestMatchedReceipt.scannedAt.getTime() >= latestMovement.occurredAt.getTime()
    ) {
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: {
          ownerType: "TERMINAL_STORE",
          warehouseId: null,
          locationId: null,
          salespersonId: null,
          terminalStoreName: latestMatchedReceipt.receivingOrganizationName,
          signedAt: latestMatchedReceipt.scannedAt,
          status: "SIGNED",
          lastMovedAt: latestMatchedReceipt.scannedAt
        }
      });
    }
  }
}

export async function linkAndReconcileTerminalReceipts(
  tx: DbClient,
  items: Array<{ id: string; barcode: string }>
) {
  if (items.length === 0) return;
  for (const item of items) {
    await tx.terminalReceiptRecord.updateMany({
      where: { inventoryItemId: null, barcode: item.barcode },
      data: { inventoryItemId: item.id }
    });
  }
  await reconcileTerminalReceiptOwnership(tx, items.map((item) => item.id));
}

export async function reconcileTrackedBarcodeReceipts(
  tx: DbClient,
  trackedBarcodeIds: string[]
) {
  const uniqueIds = Array.from(new Set(trackedBarcodeIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  const items = await tx.trackedBarcode.findMany({
    where: { id: { in: uniqueIds } },
    include: {
      movements: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] },
      terminalReceiptRecords: { orderBy: [{ scannedAt: "asc" }, { createdAt: "asc" }] }
    }
  });

  for (const item of items) {
    const acceptedReceiptIds: string[] = [];
    const conflictReceiptIds: string[] = [];
    const goodsConflictReceiptIds: string[] = [];
    const flowConflictReceiptIds: string[] = [];
    const timeline = [...item.movements];
    let canonicalReceipt: (typeof item.terminalReceiptRecords)[number] | undefined;

    for (const receipt of item.terminalReceiptRecords) {
      const precedingMovement = [...timeline]
        .reverse()
        .find((movement) =>
          movement.receiptRecordId !== receipt.id &&
          movement.occurredAt.getTime() <= receipt.scannedAt.getTime()
        );
      const canFollow = canTerminalReceiptFollow(precedingMovement?.type);

      if (!canFollow) {
        conflictReceiptIds.push(receipt.id);
        flowConflictReceiptIds.push(receipt.id);
        continue;
      }

      const goodsConflict = Boolean(
        canonicalReceipt && canonicalReceipt.externalGoodsName.trim() !== receipt.externalGoodsName.trim()
      );
      if (goodsConflict) {
        conflictReceiptIds.push(receipt.id);
        goodsConflictReceiptIds.push(receipt.id);
      } else {
        canonicalReceipt ??= receipt;
        acceptedReceiptIds.push(receipt.id);
      }
      const existingMovement = timeline.find((movement) => movement.receiptRecordId === receipt.id);
      if (!existingMovement) {
        const movement = await tx.trackingMovement.create({
          data: {
            trackedBarcodeId: item.id,
            barcode: item.barcode,
            type: "QINCE_RECEIPT",
            fromOwnerType: precedingMovement?.toOwnerType ?? "SALESPERSON",
            toOwnerType: "TERMINAL_STORE",
            fromLabel: precedingMovement?.toLabel ?? "销售人员",
            toLabel: `终端店铺：${receipt.receivingOrganizationName}`,
            operatorName: "勤策同步",
            occurredAt: receipt.scannedAt,
            note: `勤策扫码签收；商品：${receipt.externalGoodsName}`,
            receiptRecordId: receipt.id
          }
        });
        timeline.push(movement);
        timeline.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
      }
    }

    if (acceptedReceiptIds.length > 0) {
      await tx.terminalReceiptRecord.updateMany({ where: { id: { in: acceptedReceiptIds } }, data: { matchStatus: "MATCHED" } });
    }
    if (conflictReceiptIds.length > 0) {
      await tx.terminalReceiptRecord.updateMany({ where: { id: { in: conflictReceiptIds } }, data: { matchStatus: "CONFLICT" } });
    }

    const latestMovement = timeline.at(-1);
    const latestReceipt = latestMovement?.receiptRecordId
      ? item.terminalReceiptRecords.find((receipt) => receipt.id === latestMovement.receiptRecordId)
      : undefined;
    const hasGoodsConflict = goodsConflictReceiptIds.length > 0;
    const hasCurrentFlowConflict = flowConflictReceiptIds.some((id) => {
      const receipt = item.terminalReceiptRecords.find((entry) => entry.id === id);
      return Boolean(receipt && latestMovement && receipt.scannedAt.getTime() >= latestMovement.occurredAt.getTime());
    });
    const receiptStatus = hasGoodsConflict || hasCurrentFlowConflict
      ? "EXCEPTION"
      : latestMovement?.type === "SALES_OUTBOUND" || latestMovement?.type === "TRANSFER"
        ? "PENDING"
        : "SIGNED";

    if (latestMovement?.type === "QINCE_RECEIPT" && latestReceipt) {
      await tx.trackedBarcode.update({
        where: { id: item.id },
        data: {
          externalGoodsName: canonicalReceipt?.externalGoodsName ?? latestReceipt.externalGoodsName,
          goodsUnit: canonicalReceipt?.goodsUnit ?? latestReceipt.goodsUnit,
          currentOwnerType: "TERMINAL_STORE",
          warehouseId: null,
          salespersonId: null,
          terminalStoreName: latestReceipt.receivingOrganizationName,
          signedAt: latestReceipt.scannedAt,
          receiptStatus,
          lastMovedAt: latestReceipt.scannedAt
        }
      });
    } else if (canonicalReceipt || hasCurrentFlowConflict || hasGoodsConflict) {
      await tx.trackedBarcode.update({
        where: { id: item.id },
        data: {
          externalGoodsName: canonicalReceipt?.externalGoodsName,
          goodsUnit: canonicalReceipt?.goodsUnit,
          receiptStatus
        }
      });
    }
  }
}

export async function linkAndReconcileTrackedReceipts(
  tx: DbClient,
  items: Array<{ id: string; barcode: string }>
) {
  if (items.length === 0) return;
  for (const item of items) {
    await tx.terminalReceiptRecord.updateMany({
      where: { trackedBarcodeId: null, barcode: item.barcode },
      data: { trackedBarcodeId: item.id }
    });
  }
  await reconcileTrackedBarcodeReceipts(tx, items.map((item) => item.id));
}

export async function reconcileTrackedReceiptConflicts() {
  const prisma = getPrisma();
  const candidates = await prisma.terminalReceiptRecord.findMany({
    where: { matchStatus: "CONFLICT", trackedBarcodeId: { not: null } },
    select: { id: true, importId: true, trackedBarcodeId: true }
  });
  const trackedBarcodeIds = Array.from(new Set(candidates.flatMap((record) => record.trackedBarcodeId ? [record.trackedBarcodeId] : [])));
  const importIds = Array.from(new Set(candidates.map((record) => record.importId)));

  for (let index = 0; index < trackedBarcodeIds.length; index += RECONCILIATION_BATCH_SIZE) {
    const batch = trackedBarcodeIds.slice(index, index + RECONCILIATION_BATCH_SIZE);
    await prisma.$transaction(
      (tx) => reconcileTrackedBarcodeReceipts(tx, batch),
      { maxWait: 10_000, timeout: 60_000 }
    );
  }

  const reviewedRecords = candidates.length > 0
    ? await prisma.terminalReceiptRecord.findMany({
        where: { id: { in: candidates.map((record) => record.id) } },
        select: { matchStatus: true }
      })
    : [];

  if (importIds.length > 0) {
    const groupedCounts = await prisma.terminalReceiptRecord.groupBy({
      by: ["importId", "matchStatus"],
      where: { importId: { in: importIds } },
      _count: { _all: true }
    });
    const countsByImport = new Map<string, { matched: number; unmatched: number; conflicts: number }>();
    for (const row of groupedCounts) {
      const counts = countsByImport.get(row.importId) ?? { matched: 0, unmatched: 0, conflicts: 0 };
      if (row.matchStatus === "MATCHED") counts.matched = row._count._all;
      else if (row.matchStatus === "UNMATCHED") counts.unmatched = row._count._all;
      else counts.conflicts = row._count._all;
      countsByImport.set(row.importId, counts);
    }
    for (const importId of importIds) {
      const counts = countsByImport.get(importId) ?? { matched: 0, unmatched: 0, conflicts: 0 };
      await prisma.$transaction([
        prisma.terminalReceiptImport.update({
          where: { id: importId },
          data: { matchedRows: counts.matched, unmatchedRows: counts.unmatched, conflictRows: counts.conflicts }
        }),
        prisma.terminalReceiptSyncRun.updateMany({
          where: { importId },
          data: { matchedRows: counts.matched, unmatchedRows: counts.unmatched, conflictRows: counts.conflicts }
        })
      ]);
    }
  }

  const remainingConflictRows = reviewedRecords.filter((record) => record.matchStatus === "CONFLICT").length;
  return {
    reviewedBarcodes: trackedBarcodeIds.length,
    reviewedRows: candidates.length,
    resolvedRows: reviewedRecords.length - remainingConflictRows,
    remainingConflictRows,
    updatedImports: importIds.length
  };
}
