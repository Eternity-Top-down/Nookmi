import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const python = resolve(
  root,
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
if (!existsSync(python)) {
  console.error("尚未准备 Python 环境，请先运行 npm run setup:backend。");
  process.exit(1);
}
const onlyBackend = process.argv.includes("--backend");
const backend = spawn(
  python,
  [
    "-m",
    "uvicorn",
    "backend.app.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
  ],
  {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  },
);
const children = [backend];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

async function waitForBackend() {
  for (let i = 0; i < 80 && !stopping; i++) {
    try {
      const health = await fetch("http://127.0.0.1:8000/api/health", {
        signal: AbortSignal.timeout(1000),
      });
      if (health.ok && (await health.json()).service === "nookmi")
        return !stopping;
    } catch {
      /* Python may still be loading. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}
backend.on("error", (error) => {
  console.error(error.message);
  stop(1);
});
backend.on("exit", (code) => {
  if (!stopping) {
    console.error("Python 后端已停止。");
    stop(code || 1);
  }
});
if (!onlyBackend) {
  const ready = await waitForBackend();
  if (stopping) {
    // A cancelled startup must not launch a new child after cleanup.
  } else if (!ready) {
    console.error("后端未能启动。请检查上方错误，以及 8000 端口是否已被占用。");
    stop(1);
  } else {
    const frontend = spawn(
      process.execPath,
      [
        resolve(root, "node_modules/vite/bin/vite.js"),
        "--host",
        "127.0.0.1",
        "--port",
        "5173",
        "--strictPort",
      ],
      {
        cwd: root,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    children.push(frontend);
    frontend.on("error", (error) => {
      console.error(error.message);
      stop(1);
    });
    frontend.on("exit", (code) => {
      if (!stopping) stop(code || 0);
    });
    console.log(
      "\nNookmi 已启动：打开 http://127.0.0.1:5173/。保留此窗口，按 Ctrl+C 停止。\n",
    );
  }
}
