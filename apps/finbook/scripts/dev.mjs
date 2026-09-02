import { spawn } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required to start Finbook");

const children = [
  spawn(process.execPath, [npmCli, "run", "dev:server"], { stdio: "inherit" }),
  spawn(process.execPath, [npmCli, "run", "dev:browser"], { stdio: "inherit" }),
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
  process.exitCode = exitCode;
}

for (const child of children) {
  child.once("error", (error) => {
    console.error(error);
    stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping && code !== 0) stop(code ?? 1);
  });
}

process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
