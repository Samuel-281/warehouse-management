import { randomUUID } from "node:crypto";

import { ApiError } from "@/lib/api-response";
import { getPrisma } from "@/lib/db";
import {
  buildQinceBrowserTerminalReceiptExport,
  type QinceBrowserScanRecord
} from "@/lib/services/qince-terminal-receipt-client";
import {
  BROWSER_CONNECTOR_PENDING,
  BROWSER_CONNECTOR_PROCESSING_PREFIX
} from "@/lib/services/terminal-receipt-sync-config";
import {
  executeTerminalReceiptSync,
  failTerminalReceiptSync
} from "@/lib/services/terminal-receipt-sync-service";

const CLAIM_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_RECORDS = 10_000;

export type BrowserConnectorTask = {
  id: string;
  claimToken: string;
  trigger: "manual" | "scheduled";
  startDate: string;
  endDate: string;
  queryUrl: string;
  menuId: string;
  pageSize: number;
  maxRecords: number;
};

export async function claimBrowserConnectorTask(now = new Date()): Promise<BrowserConnectorTask | null> {
  const prisma = getPrisma();
  await prisma.terminalReceiptSyncRun.updateMany({
    where: {
      status: "RUNNING",
      externalTaskKey: { startsWith: BROWSER_CONNECTOR_PROCESSING_PREFIX },
      startedAt: { lt: new Date(now.getTime() - CLAIM_TIMEOUT_MS) }
    },
    data: { externalTaskKey: BROWSER_CONNECTOR_PENDING, errorMessage: null }
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pending = await prisma.terminalReceiptSyncRun.findFirst({
      where: { status: "RUNNING", externalTaskKey: BROWSER_CONNECTOR_PENDING },
      orderBy: { createdAt: "asc" }
    });
    if (!pending) return null;

    const claimToken = randomUUID();
    const claimed = await prisma.terminalReceiptSyncRun.updateMany({
      where: { id: pending.id, status: "RUNNING", externalTaskKey: BROWSER_CONNECTOR_PENDING },
      data: {
        externalTaskKey: `${BROWSER_CONNECTOR_PROCESSING_PREFIX}${claimToken}`,
        startedAt: now,
        errorMessage: null
      }
    });
    if (claimed.count !== 1) continue;

    return {
      id: pending.id,
      claimToken,
      trigger: pending.trigger === "MANUAL" ? "manual" : "scheduled",
      startDate: formatDateOnly(pending.exportStartDate),
      endDate: formatDateOnly(pending.exportEndDate),
      queryUrl: "https://cloud.region2.qince.com/app/goodscode/scancode/detail/codelist.do",
      menuId: "9154495129720347956",
      pageSize: 1_000,
      maxRecords: MAX_RECORDS
    };
  }
  return null;
}

export async function completeBrowserConnectorTask(input: {
  runId: string;
  claimToken: string;
  records: QinceBrowserScanRecord[];
}) {
  if (!Array.isArray(input.records)) throw new ApiError("连接器回传的扫码记录格式无效", 400);
  if (input.records.length > MAX_RECORDS) {
    throw new ApiError(`单次最多接收 ${MAX_RECORDS.toLocaleString("zh-CN")} 条扫码记录`, 413);
  }
  const run = await assertClaim(input.runId, input.claimToken);
  const exportResult = await buildQinceBrowserTerminalReceiptExport({
    startDate: formatDateOnly(run.exportStartDate),
    endDate: formatDateOnly(run.exportEndDate),
    records: input.records
  });
  return executeTerminalReceiptSync(run.id, { download: async () => exportResult });
}

export async function failBrowserConnectorTask(input: {
  runId: string;
  claimToken: string;
  errorMessage: string;
}) {
  const run = await assertClaim(input.runId, input.claimToken);
  const message = input.errorMessage.replace(/[\r\n\t]+/g, " ").trim().slice(0, 500) || "勤策浏览器连接器同步失败";
  return failTerminalReceiptSync(run.id, new Error(message));
}

async function assertClaim(runId: string, claimToken: string) {
  if (!runId || !claimToken) throw new ApiError("连接器任务凭据不完整", 400);
  const run = await getPrisma().terminalReceiptSyncRun.findUnique({ where: { id: runId } });
  if (!run) throw new ApiError("签收同步任务不存在", 404);
  if (run.status !== "RUNNING") throw new ApiError("签收同步任务已经结束", 409);
  if (run.externalTaskKey !== `${BROWSER_CONNECTOR_PROCESSING_PREFIX}${claimToken}`) {
    throw new ApiError("连接器任务领取凭据已经失效", 409);
  }
  return run;
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}
