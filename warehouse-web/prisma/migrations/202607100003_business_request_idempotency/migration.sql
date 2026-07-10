CREATE TABLE "business_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "operationType" TEXT NOT NULL,
  "clientRequestId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "responseJson" JSONB,
  "orderId" UUID,
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "business_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_requests_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "business_requests_userId_operationType_clientRequestId_key"
  ON "business_requests"("userId", "operationType", "clientRequestId");
CREATE INDEX "business_requests_expiresAt_idx" ON "business_requests"("expiresAt");
