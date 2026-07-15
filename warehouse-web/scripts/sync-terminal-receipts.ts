import "dotenv/config";

import { getPrisma } from "@/lib/db";
import { runScheduledTerminalReceiptSync } from "@/lib/services/terminal-receipt-sync-service";

let exitCode = 0;
try {
  const result = await runScheduledTerminalReceiptSync();
  const summary = [
    `status=${result.status}`,
    `range=${result.exportStartDate}~${result.exportEndDate}`,
    `imported=${result.importedRows}`,
    `duplicates=${result.duplicateRows}`,
    `matched=${result.matchedRows}`,
    `unmatched=${result.unmatchedRows}`
  ].join(" ");
  console.log(`[terminal-receipt-sync] ${summary}`);
  if (result.status === "failure") {
    console.error(`[terminal-receipt-sync] ${result.errorMessage ?? "同步失败"}`);
    exitCode = 1;
  } else if (result.status === "running") {
    console.log("[terminal-receipt-sync] 浏览器连接器任务已排队，将在 Chrome 在线后继续执行");
  }
} catch (error) {
  console.error(`[terminal-receipt-sync] ${error instanceof Error ? error.message : "同步失败"}`);
  exitCode = 1;
} finally {
  await getPrisma().$disconnect();
}

process.exitCode = exitCode;
