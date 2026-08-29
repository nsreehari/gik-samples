import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const npmCli = process.env.npm_execpath;
const chrome = process.env.CHROME_PATH;
const port = 4175;
const baseUrl = process.env.VITE_BASE || "/";
const pageUrl = new URL(baseUrl, `http://127.0.0.1:${port}`).href;

if (!npmCli) throw new Error("Run the Pages smoke test through npm.");
if (!chrome) throw new Error("CHROME_PATH is required for the Pages smoke test.");

const preview = spawn(
  process.execPath,
  [
    npmCli,
    "exec",
    "--",
    "vite",
    "preview",
    "src/browser-host",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"], env: process.env },
);

let previewOutput = "";
preview.stdout.on("data", (chunk) => {
  previewOutput += chunk;
});
preview.stderr.on("data", (chunk) => {
  previewOutput += chunk;
});

async function waitForPreview() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (preview.exitCode !== null) {
      throw new Error(`Vite preview exited before startup:\n${previewOutput}`);
    }
    try {
      const response = await fetch(pageUrl);
      if (response.ok) return;
    } catch {}
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${pageUrl}:\n${previewOutput}`);
}

function dumpPage() {
  return new Promise((resolve, reject) => {
    const browser = spawn(chrome, [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--virtual-time-budget=15000",
      "--dump-dom",
      pageUrl,
    ]);
    let stdout = "";
    let stderr = "";
    browser.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    browser.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    browser.once("error", reject);
    browser.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Chrome exited with ${code}:\n${stderr}`));
    });
  });
}

try {
  await waitForPreview();
  const html = await dumpPage();
  if (!html.includes("Generative Interaction Kernel")) {
    throw new Error(`Built Pages host did not render its application shell:\n${html.slice(0, 2000)}`);
  }
  if (html.includes("GIK Studio could not start")) {
    throw new Error(`Built Pages host rendered its startup failure shell:\n${html.slice(0, 2000)}`);
  }
  console.log(`Pages smoke test passed at ${pageUrl}`);
} finally {
  preview.kill();
}
