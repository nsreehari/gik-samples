import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const chrome = process.env.CHROME_PATH;
const port = 4175;
const baseUrl = process.env.VITE_BASE || "/";
const pageUrl = new URL(baseUrl, `http://127.0.0.1:${port}`).href;
const previewCli = fileURLToPath(new URL("./static-preview.mjs", import.meta.url));

if (!chrome) throw new Error("CHROME_PATH is required for the Pages smoke test.");

const preview = spawn(
  process.execPath,
  [previewCli],
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
      throw new Error(`Static preview exited before startup:\n${previewOutput}`);
    }
    try {
      const response = await fetch(pageUrl);
      if (response.ok) return;
    } catch {}
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${pageUrl}:\n${previewOutput}`);
}

function dumpPage(url = pageUrl) {
  return new Promise((resolve, reject) => {
    const browser = spawn(chrome, [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--virtual-time-budget=15000",
      "--dump-dom",
      url,
    ]);
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      browser.kill();
      reject(new Error(`Chrome timed out rendering ${url}:\n${stderr}`));
    }, 30_000);
    browser.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    browser.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    browser.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    browser.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Chrome exited with ${code}:\n${stderr}`));
    });
  });
}

try {
  await waitForPreview();
  const guideUrl = new URL("getting-started/", pageUrl);
  const guideResponse = await fetch(guideUrl);
  if (!guideResponse.ok) throw new Error(`Sample app guide returned HTTP ${guideResponse.status}`);
  const guide = await guideResponse.text();
  if (!guide.includes("<h1>Build a sample app</h1>")
    || !guide.includes("https://github.com/nsreehari/gik-samples/tree/main/apps/finbook")
    || !guide.includes("npm run check")) {
    throw new Error("Pages sample app guide is missing its walkthrough or reference source");
  }
  const docsUrl = new URL("docs/", pageUrl);
  const docsResponse = await fetch(docsUrl);
  if (!docsResponse.ok) throw new Error(`Documentation hub returned HTTP ${docsResponse.status}`);
  const docs = await docsResponse.text();
  if (!docs.includes('id="concepts"') || !docs.includes('id="samples"')
    || !docs.includes('id="packages"') || !docs.includes('id="hosting"')) {
    throw new Error("Pages documentation hub is missing its learning paths");
  }
  const stylesheetResponse = await fetch(new URL("site.css", docsUrl));
  if (!stylesheetResponse.ok || !stylesheetResponse.headers.get("content-type")?.includes("text/css")) {
    throw new Error("Pages documentation stylesheet was not served as CSS");
  }
  const storybookResponse = await fetch(new URL("storybook/index.json", pageUrl));
  if (!storybookResponse.ok || !(await storybookResponse.json()).entries?.["start-here--overview"]) {
    throw new Error("Built Storybook is missing its documentation entry point");
  }
  if (process.env.CHECK_PACKAGE_DOWNLOADS === "true") {
    const vendorUrl = new URL("vendor/", pageUrl);
    const manifestResponse = await fetch(new URL("manifest.json", vendorUrl));
    if (!manifestResponse.ok) throw new Error(`Package manifest returned HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    if (manifest.format !== "gik-pages-packages/1" || manifest.packages?.length !== 11
      || new Set(manifest.packages.map(({ name }) => name)).size !== 11) {
      throw new Error("Pages must expose all eleven released GIK packages");
    }
    for (const entry of manifest.packages) {
      const response = await fetch(new URL(entry.file, vendorUrl));
      if (!response.ok) throw new Error(`Package download ${entry.file} returned HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
        throw new Error(`Served package download ${entry.file} does not match the manifest`);
      }
    }
    for (const file of ["index.html", "SHA256SUMS"]) {
      const response = await fetch(new URL(file, vendorUrl));
      if (!response.ok) throw new Error(`Package download index ${file} returned HTTP ${response.status}`);
      const content = await response.text();
      if (!manifest.packages.every(({ file }) => content.includes(file))) {
        throw new Error(`Package download index ${file} is incomplete`);
      }
    }
    console.log(`All 11 package downloads and checksums passed at ${vendorUrl}`);
  }
  const html = await dumpPage();
  if (!html.includes("Generative Interaction Kernel")) {
    throw new Error(`Built Pages host did not render its application shell:\n${html.slice(0, 2000)}`);
  }
  if (html.includes("GIK Studio could not start")) {
    throw new Error(`Built Pages host rendered its startup failure shell:\n${html.slice(0, 2000)}`);
  }
  if (!html.includes(new URL(guideUrl).pathname)) {
    throw new Error("Built Pages host does not link to the sample app guide");
  }
  if (!html.includes(docsUrl.pathname)) {
    throw new Error("Built Pages host does not link to the documentation hub");
  }
  for (const [id, viewMode] of [
    ["primitive-components-metric--standard", "story"],
    ["primitive-components-metric--docs", "docs"],
  ]) {
    const url = new URL("storybook/iframe.html", pageUrl);
    url.searchParams.set("id", id);
    url.searchParams.set("viewMode", viewMode);
    const story = await dumpPage(url.href);
    if (!story.includes("Authoring contract") || !story.includes("All displayed examples pass")) {
      throw new Error(`Built Storybook ${viewMode} did not render the validated component contract`);
    }
  }
  console.log("Storybook component canvas and autodocs rendered their validated contracts");
  console.log(`Documentation hub, shared CSS, and Storybook navigation passed at ${docsUrl}`);
  console.log(`Sample app guide and home navigation passed at ${guideUrl}`);
  console.log(`Pages smoke test passed at ${pageUrl}`);
} finally {
  preview.kill();
}
