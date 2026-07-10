import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { BackupStatus } from "@/lib/types";

export async function readBackupStatus(): Promise<BackupStatus> {
  const statusFile = process.env.BACKUP_STATUS_FILE || join(process.cwd(), "runtime", "backup-status.json");
  try {
    const parsed = JSON.parse(await readFile(statusFile, "utf8")) as Partial<BackupStatus>;
    if (parsed.status !== "success" && parsed.status !== "failure") return unknownStatus();
    return {
      status: parsed.status,
      completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : undefined,
      fileName: typeof parsed.fileName === "string" ? parsed.fileName : undefined,
      sizeBytes: typeof parsed.sizeBytes === "number" ? parsed.sizeBytes : undefined,
      checksumVerified: typeof parsed.checksumVerified === "boolean" ? parsed.checksumVerified : undefined,
      destination: parsed.destination === "oss" || parsed.destination === "local" ? parsed.destination : undefined,
      message: typeof parsed.message === "string" ? parsed.message : undefined
    };
  } catch {
    return unknownStatus();
  }
}

function unknownStatus(): BackupStatus {
  return { status: "unknown", message: "尚未发现备份状态记录" };
}
