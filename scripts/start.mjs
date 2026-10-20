import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
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

async function portInUse(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", (error) => {
      if (error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
    socket.setTimeout(1500, () => {
      socket.destroy();
      reject(new Error(`无法检查 ${port} 端口，请稍后重试。`));
    });
  });
}

// Do not attach to an existing instance or start children over occupied ports.
for (const port of onlyBackend ? [8000] : [8000, 5173]) {
  try {
    if (await portInUse(port)) {
      console.error(`${port} 端口已被占用。若工作台已经打开，请继续使用原窗口；更新后请先关闭原启动窗口，再重新启动工作台。`);
      process.exit(1);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

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
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === "win32") {
      // A Windows venv can launch a second Python process. Stop our entire
      // child tree so that the interpreter cannot keep serving an old API.
      const cleanup = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      cleanup.on("error", () => {
        child.kill();
        console.error("未能完整停止工作台，请检查原启动窗口是否仍在运行。");
      });
      cleanup.on("exit", (code) => {
        if (code && child.exitCode === null) {
          console.error("工作台进程未能完全退出，请检查原启动窗口是否仍在运行。");
        }
      });
    } else {
      child.kill();
    }
  }
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
      if (health.ok) {
        const status = await health.json();
        if (status.service === "nookmi") {
          if (status.version !== version) {
            console.error("检测到旧版 Python 后端仍在运行。请保留页面输入，关闭原工作台启动窗口，再重新启动工作台。");
            return false;
          }
          return !stopping;
        }
      }
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
