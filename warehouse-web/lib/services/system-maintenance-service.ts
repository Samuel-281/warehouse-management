import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function clearOperationalData() {
  const prismaBin = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");

  await execFileAsync(prismaBin, ["db", "execute", "--file", "prisma/clear-operational-data.sql"], {
    cwd: process.cwd()
  });
}
