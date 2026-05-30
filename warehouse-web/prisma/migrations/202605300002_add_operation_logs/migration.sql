CREATE TABLE "operation_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID,
  "username" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "result" TEXT NOT NULL,
  "detail" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "operation_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "operation_logs_userId_idx" ON "operation_logs"("userId");
CREATE INDEX "operation_logs_action_idx" ON "operation_logs"("action");
CREATE INDEX "operation_logs_targetType_idx" ON "operation_logs"("targetType");
CREATE INDEX "operation_logs_createdAt_idx" ON "operation_logs"("createdAt");

ALTER TABLE "operation_logs"
  ADD CONSTRAINT "operation_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
