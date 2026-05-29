import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const wasmDir = path.join(root, "node_modules", "@next", "swc-wasm-nodejs");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

if (existsSync(path.join(wasmDir, "wasm.js"))) {
  process.env.NEXT_TEST_WASM_DIR ??= wasmDir;
}

process.env.NEXT_TELEMETRY_DISABLED ??= "1";

const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit"
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
