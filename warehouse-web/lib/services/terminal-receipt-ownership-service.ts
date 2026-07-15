import { Prisma } from "@prisma/client";

type DbClient = Prisma.TransactionClient;

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
