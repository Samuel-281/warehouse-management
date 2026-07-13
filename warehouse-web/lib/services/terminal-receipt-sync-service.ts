import { Prisma, TerminalReceiptSyncStatus, TerminalReceiptSyncTrigger } from "@prisma/client";

import { ApiError } from "@/lib/api-response";
import { getPrisma } from "@/lib/db";
import {
  downloadQinceTerminalReceipts,
  qinceOpenApiConfigured
} from "@/lib/services/qince-terminal-receipt-client";
import { logOperation } from "@/lib/services/operation-log-service";
import { importTerminalReceipts } from "@/lib/services/terminal-receipt-service";
import type { TerminalReceiptSyncOverview, TerminalReceiptSyncRun } from "@/lib/types";
import { formatAppDateTime } from "@/lib/warehouse-utils";

const SHANGHAI_OFFSET = "+08:00";
const STALE_RUN_MS = 30 * 60 * 1000;
const INITIAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

type SyncTrigger = "MANUAL" | "SCHEDULED";

type DownloadDependency = typeof downloadQinceTerminalReceipts;

export async function getTerminalReceiptSyncOverview(limit = 10): Promise<TerminalReceiptSyncOverview> {
  const prisma = getPrisma();
  const take = Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.floor(limit))) : 10;
  const [runs, lastSuccess] = await Promise.all([
    prisma.terminalReceiptSyncRun.findMany({ orderBy: { createdAt: "desc" }, take }),
    prisma.terminalReceiptSyncRun.findFirst({
      where: { status: "SUCCESS" },
      orderBy: { logicalEndAt: "desc" },
      select: { logicalEndAt: true }
    })
  ]);
  return {
    configured: qinceOpenApiConfigured(),
    configurationMessage: qinceOpenApiConfigured()
      ? "已连接勤策 OpenAPI"
      : "需要配置勤策 OpenAPI 的 OpenID、AppKey，并授权扫码结果明细查询接口",
    running: runs.some((run) => run.status === "RUNNING"),
    lastSuccessfulCutoff: lastSuccess ? formatAppDateTime(lastSuccess.logicalEndAt) : undefined,
    nextScheduledAt: formatAppDateTime(nextMondayStart(new Date())),
    scheduleDescription: "每周一 00:00 自动同步上一周数据",
    runs: runs.map(mapSyncRun)
  };
}

export async function createTerminalReceiptSyncRun(input: {
  trigger: SyncTrigger;
  operatorName: string;
  now?: Date;
}): Promise<TerminalReceiptSyncRun> {
  const prisma = getPrisma();
  const now = input.now ?? new Date();
  await prisma.terminalReceiptSyncRun.updateMany({
    where: { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
    data: {
      status: "FAILURE",
      finishedAt: now,
      errorMessage: "同步进程异常中断，已由后续任务自动结束"
    }
  });

  const window = await buildSyncWindow(input.trigger, now);
  try {
    const run = await prisma.terminalReceiptSyncRun.create({
      data: {
        trigger: input.trigger,
        status: "RUNNING",
        logicalStartAt: window.logicalStartAt,
        logicalEndAt: window.logicalEndAt,
        exportStartDate: dateOnlyAsUtc(window.exportStartDate),
        exportEndDate: dateOnlyAsUtc(window.exportEndDate),
        operatorName: input.operatorName
      }
    });
    return mapSyncRun(run);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError("已有签收同步任务正在运行，请等待完成后再试", 409);
    }
    throw error;
  }
}

export async function executeTerminalReceiptSync(
  runId: string,
  dependencies: { download?: DownloadDependency } = {}
) {
  const prisma = getPrisma();
  const run = await prisma.terminalReceiptSyncRun.findUnique({ where: { id: runId } });
  if (!run) throw new ApiError("签收同步任务不存在", 404);
  if (run.status !== "RUNNING") return mapSyncRun(run);
  const download = dependencies.download ?? downloadQinceTerminalReceipts;

  try {
    const exportResult = await download({
      startDate: formatDateOnly(run.exportStartDate),
      endDate: formatDateOnly(run.exportEndDate)
    });
    if (exportResult.recordCount === 0) {
      return finishEmptySyncRun(run, exportResult);
    }
    const summary = await importTerminalReceipts({
      fileName: exportResult.fileName,
      buffer: exportResult.buffer,
      operatorName: run.operatorName,
      allowNoNewRows: true
    });
    const replayed = summary.replayed === true;
    const finishedAt = new Date();
    const completed = await prisma.terminalReceiptSyncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        finishedAt,
        externalTaskKey: exportResult.taskKey,
        externalFileName: exportResult.fileName,
        importId: summary.id,
        totalRows: summary.totalRows,
        importedRows: replayed ? 0 : summary.importedRows,
        matchedRows: replayed ? 0 : summary.matchedRows,
        unmatchedRows: replayed ? 0 : summary.unmatchedRows,
        duplicateRows: replayed ? summary.totalRows : summary.duplicateRows,
        invalidRows: summary.invalidRows
      }
    });
    await logOperation({
      username: run.trigger === "SCHEDULED" ? "system" : run.operatorName,
      action: "TERMINAL_RECEIPT_SYNC",
      targetType: "TERMINAL_RECEIPT_SYNC",
      targetId: run.id,
      result: "SUCCESS",
      detail: `trigger=${run.trigger};range=${formatDateOnly(run.exportStartDate)}~${formatDateOnly(run.exportEndDate)};imported=${replayed ? 0 : summary.importedRows};matched=${replayed ? 0 : summary.matchedRows};unmatched=${replayed ? 0 : summary.unmatchedRows};duplicates=${replayed ? summary.totalRows : summary.duplicateRows}`
    });
    return mapSyncRun(completed);
  } catch (error) {
    const message = safeErrorMessage(error);
    const failed = await prisma.terminalReceiptSyncRun.update({
      where: { id: run.id },
      data: { status: "FAILURE", finishedAt: new Date(), errorMessage: message }
    });
    await logOperation({
      username: run.trigger === "SCHEDULED" ? "system" : run.operatorName,
      action: "TERMINAL_RECEIPT_SYNC",
      targetType: "TERMINAL_RECEIPT_SYNC",
      targetId: run.id,
      result: "FAILURE",
      detail: `trigger=${run.trigger};range=${formatDateOnly(run.exportStartDate)}~${formatDateOnly(run.exportEndDate)};error=${message}`
    });
    return mapSyncRun(failed);
  }
}

export async function runScheduledTerminalReceiptSync(now = new Date()) {
  const run = await createTerminalReceiptSyncRun({
    trigger: "SCHEDULED",
    operatorName: "系统自动同步",
    now
  });
  return executeTerminalReceiptSync(run.id);
}

async function buildSyncWindow(trigger: SyncTrigger, now: Date) {
  if (trigger === "SCHEDULED") {
    const logicalEndAt = currentMondayStart(now);
    const logicalStartAt = new Date(logicalEndAt.getTime() - INITIAL_LOOKBACK_MS);
    return {
      logicalStartAt,
      logicalEndAt,
      exportStartDate: shanghaiDate(logicalStartAt),
      exportEndDate: shanghaiDate(new Date(logicalEndAt.getTime() - 1))
    };
  }

  const lastSuccess = await getPrisma().terminalReceiptSyncRun.findFirst({
    where: { status: "SUCCESS" },
    orderBy: { logicalEndAt: "desc" },
    select: { logicalEndAt: true }
  });
  const logicalStartAt = lastSuccess?.logicalEndAt ?? new Date(now.getTime() - INITIAL_LOOKBACK_MS);
  return {
    logicalStartAt: logicalStartAt > now ? now : logicalStartAt,
    logicalEndAt: now,
    exportStartDate: shanghaiDate(logicalStartAt > now ? now : logicalStartAt),
    exportEndDate: shanghaiDate(now)
  };
}

function currentMondayStart(value: Date) {
  const parts = shanghaiParts(value);
  const calendar = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = calendar.getUTCDay() || 7;
  calendar.setUTCDate(calendar.getUTCDate() - day + 1);
  return new Date(`${calendar.toISOString().slice(0, 10)}T00:00:00${SHANGHAI_OFFSET}`);
}

function nextMondayStart(value: Date) {
  const current = currentMondayStart(value);
  return value < current ? current : new Date(current.getTime() + INITIAL_LOOKBACK_MS);
}

function shanghaiDate(value: Date) {
  const { year, month, day } = shanghaiParts(value);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shanghaiParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(lookup.get("year")),
    month: Number(lookup.get("month")),
    day: Number(lookup.get("day"))
  };
}

function dateOnlyAsUtc(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error && error.message ? error.message : "签收自动同步失败";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

async function finishEmptySyncRun(
  run: {
    id: string;
    trigger: TerminalReceiptSyncTrigger;
    exportStartDate: Date;
    exportEndDate: Date;
    operatorName: string;
  },
  exportResult: { taskKey: string; fileName: string }
) {
  const completed = await getPrisma().terminalReceiptSyncRun.update({
    where: { id: run.id },
    data: {
      status: "SUCCESS",
      finishedAt: new Date(),
      externalTaskKey: exportResult.taskKey,
      externalFileName: exportResult.fileName,
      totalRows: 0,
      importedRows: 0,
      matchedRows: 0,
      unmatchedRows: 0,
      duplicateRows: 0,
      invalidRows: 0
    }
  });
  await logOperation({
    username: run.trigger === "SCHEDULED" ? "system" : run.operatorName,
    action: "TERMINAL_RECEIPT_SYNC",
    targetType: "TERMINAL_RECEIPT_SYNC",
    targetId: run.id,
    result: "SUCCESS",
    detail: `trigger=${run.trigger};range=${formatDateOnly(run.exportStartDate)}~${formatDateOnly(run.exportEndDate)};imported=0;matched=0;unmatched=0;duplicates=0`
  });
  return mapSyncRun(completed);
}

function mapSyncRun(value: {
  id: string;
  trigger: TerminalReceiptSyncTrigger;
  status: TerminalReceiptSyncStatus;
  logicalStartAt: Date;
  logicalEndAt: Date;
  exportStartDate: Date;
  exportEndDate: Date;
  externalFileName: string | null;
  totalRows: number;
  importedRows: number;
  matchedRows: number;
  unmatchedRows: number;
  duplicateRows: number;
  invalidRows: number;
  operatorName: string;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}): TerminalReceiptSyncRun {
  return {
    id: value.id,
    trigger: value.trigger === "MANUAL" ? "manual" : "scheduled",
    status: value.status === "RUNNING" ? "running" : value.status === "SUCCESS" ? "success" : "failure",
    logicalStartAt: formatAppDateTime(value.logicalStartAt),
    logicalEndAt: formatAppDateTime(value.logicalEndAt),
    exportStartDate: formatDateOnly(value.exportStartDate),
    exportEndDate: formatDateOnly(value.exportEndDate),
    externalFileName: value.externalFileName ?? undefined,
    totalRows: value.totalRows,
    importedRows: value.importedRows,
    matchedRows: value.matchedRows,
    unmatchedRows: value.unmatchedRows,
    duplicateRows: value.duplicateRows,
    invalidRows: value.invalidRows,
    operatorName: value.operatorName,
    errorMessage: value.errorMessage ?? undefined,
    startedAt: formatAppDateTime(value.startedAt),
    finishedAt: value.finishedAt ? formatAppDateTime(value.finishedAt) : undefined
  };
}
