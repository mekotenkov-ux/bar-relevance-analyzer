import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serviceDirectory = dirname(fileURLToPath(import.meta.url));
const configured = process.env.PHRASE_EMBEDDINGS_PYTHON?.trim();
const localPython = process.platform === "win32"
  ? join(serviceDirectory, ".venv", "Scripts", "python.exe")
  : join(serviceDirectory, ".venv", "bin", "python");
const candidates = configured
  ? [{ command: configured, prefix: [] }]
  : [
      ...(existsSync(localPython) ? [{ command: localPython, prefix: [] }] : []),
      ...(process.platform === "win32"
        ? [{ command: "py", prefix: ["-3.12"] }, { command: "python", prefix: [] }]
        : [{ command: "python3", prefix: [] }, { command: "python", prefix: [] }]),
    ];

function launch(index) {
  const candidate = candidates[index];
  if (!candidate) {
    console.error("Python не найден. Создайте services/phrase-embeddings/.venv по инструкции в README.");
    process.exitCode = 1;
    return;
  }
  const child = spawn(candidate.command, [
    ...candidate.prefix,
    join(serviceDirectory, "server.py"),
  ], { stdio: "inherit", windowsHide: true });
  let spawned = false;
  child.once("spawn", () => { spawned = true; });
  child.once("error", (error) => {
    if (!spawned && error.code === "ENOENT" && !configured) launch(index + 1);
    else {
      console.error(error.message);
      process.exitCode = 1;
    }
  });
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }
}

launch(0);
