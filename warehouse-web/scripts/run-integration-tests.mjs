import "dotenv/config";

import { spawnSync } from "node:child_process";
import pg from "pg";

const { Client } = pg;
const baseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!baseUrl) {
  console.error("缺少 DATABASE_URL 或 TEST_DATABASE_URL，无法运行集成测试。");
  process.exit(1);
}

const parsed = new URL(baseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
  console.error("集成测试只允许使用本机 PostgreSQL，已拒绝非本机数据库地址。");
  process.exit(1);
}

const baseDatabase = decodeURIComponent(parsed.pathname.slice(1));
const testDatabase = process.env.TEST_DATABASE_URL ? baseDatabase : `${baseDatabase}_test`;
if (!testDatabase.endsWith("_test")) {
  console.error("测试数据库名称必须以 _test 结尾，已停止执行。");
  process.exit(1);
}

const testUrl = new URL(parsed);
testUrl.pathname = `/${encodeURIComponent(testDatabase)}`;
const adminUrl = new URL(parsed);
adminUrl.pathname = "/postgres";

const admin = new Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [testDatabase]);
  if (exists.rowCount === 0) {
    const safeDatabaseName = `"${testDatabase.replaceAll('"', '""')}"`;
    await admin.query(`CREATE DATABASE ${safeDatabaseName}`);
  }
} finally {
  await admin.end();
}

const testClient = new Client({ connectionString: testUrl.toString() });
await testClient.connect();
try {
  await testClient.query("DROP SCHEMA IF EXISTS public CASCADE");
  await testClient.query("CREATE SCHEMA public");
} finally {
  await testClient.end();
}

const env = { ...process.env, DATABASE_URL: testUrl.toString(), NODE_ENV: "test" };
run("npx", ["prisma", "migrate", "deploy"], env);
run("npx", ["tsx", "--test", "--test-concurrency=1", "tests/integration/warehouse-flows.test.ts"], env);

function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
