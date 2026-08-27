CREATE TABLE "tracking_barcode_reservations" (
  "id" UUID NOT NULL,
  "barcode" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" UUID,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tracking_barcode_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tracking_barcode_reservations_barcode_key"
  ON "tracking_barcode_reservations"("barcode");

CREATE INDEX "tracking_barcode_reservations_sessionId_idx"
  ON "tracking_barcode_reservations"("sessionId");

CREATE INDEX "tracking_barcode_reservations_expiresAt_idx"
  ON "tracking_barcode_reservations"("expiresAt");
