import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const confirmationText = "确定重置";

const rl = readline.createInterface({ input, output });

console.log("危险操作：该命令会清空本地 PostgreSQL 演示数据，并重新写入初始演示数据。");
console.log("正式环境不得直接运行此脚本。生产版同类能力必须限制为超级管理员权限，并记录操作日志。");

const answer = await rl.question(`如确认继续，请输入「${confirmationText}」：`);
rl.close();

if (answer.trim() !== confirmationText) {
  console.log("未输入正确确认文字，已取消重置。");
  process.exit(0);
}

run("prisma", ["db", "execute", "--file", "prisma/reset-demo.sql"]);
run("npm", ["run", "db:seed"]);

console.log("演示数据库已重置完成。");

function run(command, args) {
  const result = spawnSync(commandForPlatform(command), args, {
    stdio: "inherit",
    shell: false
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function commandForPlatform(command) {
  if (process.platform === "win32") {
    return `${command}.cmd`;
  }

  return command;
}
