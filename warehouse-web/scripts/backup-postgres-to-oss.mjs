import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";

import dotenv from "dotenv";

dotenv.config({ quiet: true });
dotenv.config({
  path: process.env.BACKUP_ENV_FILE || join(process.cwd(), "scripts", "backup.env"),
  override: false,
  quiet: true
});

const localOnly = process.argv.includes("--local-only");
const databaseUrl = process.env.DATABASE_URL;
const backupDirectory = process.env.BACKUP_DIRECTORY || join(process.cwd(), "backups");
const statusFile = process.env.BACKUP_STATUS_FILE || join(process.cwd(), "runtime", "backup-status.json");
const retentionDays = positiveInteger(process.env.BACKUP_LOCAL_RETENTION_DAYS, 7);
const pgDumpBin = process.env.PG_DUMP_BIN || "pg_dump";
const pgRestoreBin = process.env.PG_RESTORE_BIN || "pg_restore";
const dockerContainer = process.env.POSTGRES_DOCKER_CONTAINER?.trim();

let currentFileName;
try {
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL");
  const connection = parseDatabaseUrl(databaseUrl);
  const timestamp = fileTimestamp(new Date());
  currentFileName = `warehouse_${timestamp}.dump`;
  const dumpPath = join(backupDirectory, currentFileName);
  const checksumPath = `${dumpPath}.sha256`;

  await mkdir(backupDirectory, { recursive: true });
  await dumpDatabase(connection, dumpPath);
  await verifyDump(dumpPath);
  const checksum = await sha256File(dumpPath);
  await writeFile(checksumPath, `${checksum}  ${currentFileName}\n`, { mode: 0o600 });
  const file = await stat(dumpPath);

  let destination = "local";
  if (!localOnly) {
    await uploadToOss(dumpPath, checksumPath, new Date());
    destination = "oss";
  }

  await removeExpiredLocalBackups(backupDirectory, retentionDays);
  await writeStatus({
    status: "success",
    completedAt: new Date().toISOString(),
    fileName: currentFileName,
    sizeBytes: file.size,
    checksumVerified: true,
    destination,
    message: destination === "oss" ? "数据库备份已验证并上传 OSS" : "数据库备份已在本机验证"
  });
  console.log(`备份完成：${dumpPath}${destination === "oss" ? "，已上传 OSS" : ""}`);
} catch (error) {
  const message = safeErrorMessage(error);
  await writeStatus({
    status: "failure",
    completedAt: new Date().toISOString(),
    fileName: currentFileName,
    checksumVerified: false,
    destination: localOnly ? "local" : "oss",
    message
  }).catch(() => undefined);
  console.error(`备份失败：${message}`);
  process.exit(1);
}

async function dumpDatabase(connection, dumpPath) {
  const baseArgs = [
    "--host", connection.hostname,
    "--port", connection.port,
    "--username", connection.username,
    "--dbname", connection.database,
    "--format", "custom",
    "--no-password"
  ];
  if (dockerContainer) {
    await runCommand(
      "docker",
      ["exec", "-e", `PGPASSWORD=${connection.password}`, dockerContainer, "pg_dump", ...baseArgs],
      { stdoutFile: dumpPath }
    );
    return;
  }
  await runCommand(pgDumpBin, [...baseArgs, "--file", dumpPath], {
    env: databaseEnvironment(connection),
    discardStdout: true
  });
}

async function verifyDump(dumpPath) {
  if (dockerContainer) {
    await runCommand("docker", ["exec", "-i", dockerContainer, "pg_restore", "--list"], {
      stdinFile: dumpPath,
      discardStdout: true
    });
    return;
  }
  await runCommand(pgRestoreBin, ["--list", dumpPath], { discardStdout: true });
}

async function uploadToOss(dumpPath, checksumPath, now) {
  const bucket = process.env.OSS_BUCKET?.trim().replace(/^oss:\/\//, "").replace(/\/$/, "");
  if (!bucket) throw new Error("缺少 OSS_BUCKET；只做本机验证时请使用 --local-only");
  const prefix = (process.env.OSS_PREFIX || "warehouse-management").replace(/^\/+|\/+$/g, "");
  const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const remoteDirectory = `oss://${bucket}/${prefix}/${datePath}`;
  const commonArgs = ["--mode", "Ali-EcsRamRole"];
  if (process.env.OSSUTIL_CONFIG_FILE) commonArgs.push("-c", process.env.OSSUTIL_CONFIG_FILE);
  if (process.env.OSS_REGION) commonArgs.push("--region", process.env.OSS_REGION);
  const ossutil = process.env.OSSUTIL_BIN || "ossutil";
  await runCommand(ossutil, ["cp", dumpPath, `${remoteDirectory}/${basename(dumpPath)}`, "--force", ...commonArgs]);
  await runCommand(ossutil, ["cp", checksumPath, `${remoteDirectory}/${basename(checksumPath)}`, "--force", ...commonArgs]);
}

async function removeExpiredLocalBackups(directory, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^warehouse_.*\.(dump|dump\.sha256)$/.test(entry.name)) continue;
    const path = join(directory, entry.name);
    if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true });
  }
}

async function writeStatus(status) {
  await mkdir(dirname(statusFile), { recursive: true });
  const temporary = `${statusFile}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, statusFile);
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function parseDatabaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new Error("DATABASE_URL 不是 PostgreSQL 地址");
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database) throw new Error("DATABASE_URL 缺少数据库名称");
  return {
    hostname: url.hostname,
    port: url.port || "5432",
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    sslMode: url.searchParams.get("sslmode") || undefined
  };
}

function databaseEnvironment(connection) {
  return {
    ...process.env,
    PGPASSWORD: connection.password,
    ...(connection.sslMode ? { PGSSLMODE: connection.sslMode } : {})
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env || process.env,
      stdio: [options.stdinFile ? "pipe" : "ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    const output = options.stdoutFile ? createWriteStream(options.stdoutFile, { mode: 0o600 }) : null;
    let outputFinished = !output;
    let processFinished = false;
    let exitCode = null;
    if (output) {
      output.on("finish", () => {
        outputFinished = true;
        finish();
      });
      output.on("error", reject);
      child.stdout.pipe(output);
    }
    else if (options.discardStdout) child.stdout.resume();
    else child.stdout.pipe(process.stdout);

    if (options.stdinFile) createReadStream(options.stdinFile).pipe(child.stdin);
    child.on("error", reject);
    child.on("close", (code) => {
      processFinished = true;
      exitCode = code;
      finish();
    });

    function finish() {
      if (!processFinished || !outputFinished) return;
      if (exitCode === 0) resolve();
      else reject(new Error(`${command} 执行失败（退出码 ${exitCode}）${stderr.trim() ? `：${stderr.trim()}` : ""}`));
    }
  });
}

function fileTimestamp(date) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0")
  ];
  return `${parts.slice(0, 3).join("")}_${parts.slice(3).join("")}`;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : "未知错误";
  return databaseUrl ? message.replaceAll(databaseUrl, "[DATABASE_URL]") : message;
}
