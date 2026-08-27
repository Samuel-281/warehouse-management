import type { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api-response";
import { assertBarcodeBatchLimit } from "@/lib/business-limits";
import { getPrisma } from "@/lib/db";

export const TRACKING_RESERVATION_LEASE_SECONDS = 30;
const TRACKING_RESERVATION_LEASE_MS = TRACKING_RESERVATION_LEASE_SECONDS * 1_000;

type ReservationClient = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

type ReservationIdentity = {
  sessionId: string;
  userId?: string;
};

function normalizeSessionId(sessionId: string) {
  const normalized = sessionId.trim();
  if (!normalized || normalized.length > 128) throw new ApiError("无效的 PDA 作业会话", 400);
  return normalized;
}

function normalizeBarcodes(barcodes: string[]) {
  const normalized = Array.from(new Set(barcodes.map((barcode) => barcode.trim()).filter(Boolean)));
  assertBarcodeBatchLimit(normalized);
  return normalized;
}

function leaseExpiry() {
  return new Date(Date.now() + TRACKING_RESERVATION_LEASE_MS);
}

export async function claimTrackingBarcodeReservations(input: ReservationIdentity & { barcodes: string[] }) {
  const sessionId = normalizeSessionId(input.sessionId);
  const barcodes = normalizeBarcodes(input.barcodes);
  if (barcodes.length === 0) return { claimedBarcodes: [] as string[], occupiedBarcodes: [] as string[] };

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.trackingBarcodeReservation.deleteMany({
      where: { barcode: { in: barcodes }, expiresAt: { lte: now } }
    });
    await tx.trackingBarcodeReservation.createMany({
      data: barcodes.map((barcode) => ({
        barcode,
        sessionId,
        userId: input.userId,
        expiresAt: leaseExpiry()
      })),
      skipDuplicates: true
    });
    await tx.trackingBarcodeReservation.updateMany({
      where: { barcode: { in: barcodes }, sessionId },
      data: { userId: input.userId, expiresAt: leaseExpiry() }
    });

    const reservations = await tx.trackingBarcodeReservation.findMany({
      where: { barcode: { in: barcodes } },
      select: { barcode: true, sessionId: true }
    });
    const claimed = new Set(
      reservations.filter((reservation) => reservation.sessionId === sessionId).map((reservation) => reservation.barcode)
    );
    return {
      claimedBarcodes: barcodes.filter((barcode) => claimed.has(barcode)),
      occupiedBarcodes: barcodes.filter((barcode) => !claimed.has(barcode))
    };
  });
}

export async function heartbeatTrackingBarcodeReservations(input: ReservationIdentity & { barcodes: string[] }) {
  const sessionId = normalizeSessionId(input.sessionId);
  const barcodes = normalizeBarcodes(input.barcodes);
  if (barcodes.length === 0) {
    return { activeBarcodes: [] as string[], leaseSeconds: TRACKING_RESERVATION_LEASE_SECONDS };
  }

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.trackingBarcodeReservation.deleteMany({
      where: { barcode: { in: barcodes }, expiresAt: { lte: new Date() }, sessionId: { not: sessionId } }
    });
    await tx.trackingBarcodeReservation.updateMany({
      where: { barcode: { in: barcodes }, sessionId },
      data: { userId: input.userId, expiresAt: leaseExpiry() }
    });
    const active = await tx.trackingBarcodeReservation.findMany({
      where: { barcode: { in: barcodes }, sessionId },
      select: { barcode: true }
    });
    return {
      activeBarcodes: active.map((reservation) => reservation.barcode),
      leaseSeconds: TRACKING_RESERVATION_LEASE_SECONDS
    };
  });
}

export async function releaseTrackingBarcodeReservations(input: ReservationIdentity & { barcodes?: string[] }) {
  const sessionId = normalizeSessionId(input.sessionId);
  const barcodes = input.barcodes ? normalizeBarcodes(input.barcodes) : undefined;
  if (barcodes && barcodes.length === 0) return { releasedCount: 0 };

  const result = await getPrisma().trackingBarcodeReservation.deleteMany({
    where: {
      sessionId,
      ...(barcodes ? { barcode: { in: barcodes } } : {})
    }
  });
  return { releasedCount: result.count };
}

export async function assertTrackingBarcodeReservationsForSubmit(
  tx: Prisma.TransactionClient,
  input: { barcodes: string[]; sessionId?: string; userId?: string }
) {
  const barcodes = normalizeBarcodes(input.barcodes);
  await tx.trackingBarcodeReservation.deleteMany({
    where: { barcode: { in: barcodes }, expiresAt: { lte: new Date() } }
  });
  const reservations = await tx.trackingBarcodeReservation.findMany({
    where: { barcode: { in: barcodes } },
    select: { barcode: true, sessionId: true }
  });

  if (input.sessionId) {
    const sessionId = normalizeSessionId(input.sessionId);
    const owned = new Set(
      reservations.filter((reservation) => reservation.sessionId === sessionId).map((reservation) => reservation.barcode)
    );
    const missing = barcodes.find((barcode) => !owned.has(barcode));
    if (missing) throw new ApiError(`条码 ${missing} 的设备占用已失效，请重新扫描`, 409);
    return;
  }

  const occupied = reservations[0]?.barcode;
  if (occupied) throw new ApiError(`条码 ${occupied} 正在其他设备的待出库清单中`, 409);
}

export async function releaseSubmittedTrackingBarcodeReservations(
  tx: ReservationClient,
  input: { sessionId?: string; barcodes: string[] }
) {
  if (!input.sessionId) return;
  await tx.trackingBarcodeReservation.deleteMany({
    where: { sessionId: normalizeSessionId(input.sessionId), barcode: { in: normalizeBarcodes(input.barcodes) } }
  });
}
