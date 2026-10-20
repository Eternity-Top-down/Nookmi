import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = resolve(root, ".local/tmp");
const cache = resolve(root, ".local/pip-cache");
mkdirSync(temp, { recursive: true });
mkdirSync(cache, { recursive: true });
const env = { ...process.env, TEMP: temp, TMP: temp, PIP_CACHE_DIR: cache };
const python = resolve(
  root,
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    console.error(
      result.error?.message || "安装未完成，请检查上面的错误后重试。",
    );
    process.exit(result.status || 1);
  }
}
if (!existsSync(python))
  run(process.env.NOOKMI_PYTHON || "python", ["-m", "venv", ".venv"]);
run(python, ["-m", "ensurepip", "--upgrade"]);
run(python, [
  "-m",
  "pip",
  "install",
  "-r",
  "backend/requirements.txt",
  "--disable-pip-version-check",
]);
console.log(
  "\nPython 环境准备完成，依赖和缓存位于当前项目目录。运行 npm run start 即可使用。\n",
);
