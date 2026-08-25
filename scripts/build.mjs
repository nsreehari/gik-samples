import { spawn } from "node:child_process";

const npmCli = process.env.npm_execpath;
const dev = process.argv.includes("--dev");

if (!npmCli) throw new Error("Run this build through npm.");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}`));
    });
  });
}

await Promise.all([
  run(process.execPath, [npmCli, "run", "build", "--workspace", "@gik/components"]),
  run(process.execPath, [npmCli, "exec", "--", "tsx", "scripts/validate-bootstrap.ts"]),
]);
if (!dev) {
  await run(process.execPath, [
    npmCli,
    "exec",
    "--",
    "storybook",
    "build",
    "-c",
    "storybook/.storybook",
    "-o",
    "storybook-static",
  ]);
}
await run(process.execPath, [
  npmCli,
  "exec",
  "--",
  "vite",
  dev ? "src/browser-host" : "build",
  ...(dev ? [] : ["src/browser-host"]),
]);
