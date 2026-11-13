import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { git, inspectTarball, sha256 } from "./actions-evidence.mjs";
import { assertProvenance, assertPublicationSource, fetchProvenance } from "./npm-provenance.mjs";
import { providerPublicationMode, providersVersion } from "./workflow-policy.mjs";
import { shouldPublish } from "./publish-candidate.mjs";

const directory = ".artifacts/service-providers";
const archive = `${directory}/gik-service-providers.tgz`;
const source = () => JSON.parse(readFileSync("packages/service-providers/package.json", "utf8"));
const integrity = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: "pipe", maxBuffer: 20 * 1024 * 1024, ...options });
}
function stableTag() {
  const tag = process.env.PROVIDERS_TAG;
  if (!/^providers-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? "")) throw new Error("Expected a stable providers-v tag");
  run("git", ["fetch", "origin", "main:refs/remotes/origin/main", "--tags"]);
  const commit = git("rev-parse", `${tag}^{commit}`);
  if (commit !== git("rev-parse", "origin/main") || commit !== git("rev-parse", "HEAD")) throw new Error("Provider tag must resolve to the current main commit");
  if (tag !== `providers-v${source().version}`) throw new Error("Provider tag/version mismatch");
  assertPublicationSource(commit, process.env.GITHUB_SHA);
  return commit;
}
function verifyCandidate(handoff) {
  const candidate = JSON.parse(readFileSync(`${directory}/candidate.json`, "utf8"));
  const bytes = readFileSync(archive);
  const expected = source();
  if (candidate.format !== "gik-service-providers-candidate/1" || candidate.commit !== git("rev-parse", "HEAD")
    || candidate.name !== expected.name || candidate.version !== expected.version
    || candidate.sha256 !== sha256(bytes) || candidate.integrity !== integrity(bytes)) throw new Error("Provider candidate identity/digest mismatch");
  if (handoff && (!/^[a-f0-9]{64}$/.test(process.env.PROVIDERS_SHA ?? "") || !/^[a-f0-9]{40}$/.test(process.env.PROVIDERS_COMMIT ?? "")
    || candidate.sha256 !== process.env.PROVIDERS_SHA || candidate.commit !== process.env.PROVIDERS_COMMIT)) throw new Error("Provider validation handoff mismatch");
  inspectTarball(archive, expected);
  return candidate;
}
async function consumer(packageSpec, signatureAudit = false) {
  const temporary = mkdtempSync(join(tmpdir(), "gik-service-providers-"));
  try {
    writeFileSync(join(temporary, "package.json"), JSON.stringify({ private: true, type: "module" }));
    run("npm", ["exec", "--yes", "--package=npm@11.19.0", "--", "npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", packageSpec, "typescript@^5.9.2", "@types/node@^24"], { cwd: temporary });
    if (signatureAudit) run("npm", ["audit", "signatures"], { cwd: temporary });
    const installed = JSON.parse(readFileSync(join(temporary, "node_modules", "gik-service-providers", "package.json"), "utf8"));
    assert.equal(installed.version, source().version);
    const gmail = readFileSync(join(temporary, "node_modules", "gik-service-providers", "dist", "gmail.js"), "utf8");
    assert.doesNotMatch(gmail, /(?:from\s*|import\s*[\(])["'][^"']*(?:croner|scheduler)/);
    writeFileSync(join(temporary, "check.ts"), `
import { createGmailServiceKind, type GmailConnection } from "gik-service-providers/gmail";
import { createSchedulerServiceKind } from "gik-service-providers/scheduler";
import type { ServiceKindFactory } from "gik-controlface/services";
const kinds: ServiceKindFactory[] = [createGmailServiceKind(), createSchedulerServiceKind()];
const connection: GmailConnection = { request: async () => new Response("{}") };
console.log(kinds.length, connection);
`);
    run(process.execPath, [join(temporary, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "check.ts"], { cwd: temporary });
    run(process.execPath, ["--input-type=module", "-e", `
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const isolation = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "croner" || specifier.endsWith("/scheduler.js")) throw new Error("Gmail eagerly loaded scheduler code");
  return next(specifier, context);
} });
const gmail = await import("gik-service-providers/gmail");
isolation.deregister();
const scheduler = await import("gik-service-providers/scheduler");
assert.equal(gmail.createGmailServiceKind().manifest.id, "gmail");
assert.equal(scheduler.createSchedulerServiceKind().manifest.id, "cron-scheduler");
await assert.rejects(import("gik-service-providers"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
`], { cwd: temporary });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

async function registryMetadata(name, version) {
  const path = encodeURIComponent(name) + (version === undefined ? "" : `/${encodeURIComponent(version)}`);
  const response = await fetch(`https://registry.npmjs.org/${path}`, { redirect: "error", signal: AbortSignal.timeout(60000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm registry metadata HTTP ${response.status}`);
  return response.json();
}

const command = process.argv[2];
if (command === "checkout") {
  const tag = process.env.PROVIDERS_TAG;
  if (!/^providers-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? "")) throw new Error("Invalid provider tag");
  run("git", ["checkout", "--detach", tag]);
  stableTag();
} else if (command === "pack") {
  mkdirSync(directory, { recursive: true });
  const manifest = source();
  providersVersion([], manifest, manifest, []);
  const result = JSON.parse(run("npm", ["exec", "--yes", "--package=npm@11.19.0", "--", "npm", "pack",
    "--workspace", "gik-service-providers", "--ignore-scripts", "--json", "--pack-destination", directory]))[0];
  renameSync(`${directory}/${result.filename}`, archive);
  inspectTarball(archive, manifest);
  const bytes = readFileSync(archive);
  writeFileSync(`${directory}/candidate.json`, JSON.stringify({
    format: "gik-service-providers-candidate/1", commit: git("rev-parse", "HEAD"),
    name: manifest.name, version: manifest.version, sha256: sha256(bytes), integrity: integrity(bytes),
  }, null, 2) + "\n");
  await consumer(resolve(archive));
  console.log("Provider tarball, independent subpaths, declarations and absent root import verified");
} else if (command === "plan") {
  stableTag();
  const candidate = verifyCandidate(false);
  const mode = providerPublicationMode(await registryMetadata(candidate.name) !== null, process.env.BOOTSTRAP === "true", process.env.CONFIRM);
  appendFileSync(process.env.GITHUB_OUTPUT, `ready=${mode !== "bootstrap-required"}\n`);
  const message = mode === "bootstrap-required"
    ? `Package does not exist: bootstrap required. Dispatch this workflow from ${process.env.PROVIDERS_TAG} with bootstrap=true and explicit confirmation. No normal publishing approval will be requested.`
    : `Publication mode: ${mode}. Exact candidate bytes and source will be rechecked after protected approval.`;
  console.log(message);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Service providers publication\n${message}\n`);
} else if (command === "outputs") {
  const candidate = verifyCandidate(false);
  appendFileSync(process.env.GITHUB_OUTPUT, `sha=${candidate.sha256}\ncommit=${candidate.commit}\n`);
} else if (["verify", "publish", "bootstrap"].includes(command)) {
  stableTag();
  const candidate = verifyCandidate(true);
  if (command !== "verify") {
    if (command === "bootstrap" && (process.env.BOOTSTRAP !== "true" || process.env.CONFIRM !== "PUBLISH gik-service-providers"
      || !process.env.NODE_AUTH_TOKEN)) throw new Error("First publication requires explicit confirmation and a protected npm token");
    if (command === "publish" && process.env.BOOTSTRAP === "true") throw new Error("Bootstrap cannot use recurring publication");
    const metadata = await registryMetadata(candidate.name, candidate.version);
    if (shouldPublish(metadata, candidate)) {
      const packageExists = await registryMetadata(candidate.name) !== null;
      if (command === "bootstrap" && packageExists) throw new Error("Bootstrap cannot add new versions to an existing package");
      if (command === "publish" && !packageExists) throw new Error("Package creation requires explicit protected bootstrap");
      run("npm", ["publish", resolve(archive), "--access", "public", "--provenance", "--ignore-scripts"], { stdio: "inherit" });
    } else {
      console.log("Exact verified candidate already exists; proceeding to mandatory registry verification without uploading again");
    }
  }
} else if (command === "registry") {
  const candidate = verifyCandidate(true);
  for (let attempt = 0; ; attempt++) {
    try {
      const metadata = JSON.parse(run("npm", ["view", `${candidate.name}@${candidate.version}`, "--json"]));
      if (metadata.dist.integrity !== candidate.integrity) throw new Error("Published provider bytes differ from the reviewed candidate");
      assertProvenance(await fetchProvenance(metadata.dist), process.env.GITHUB_REPOSITORY, candidate.commit, ".github/workflows/release-service-providers.yml");
      await consumer(`${candidate.name}@${candidate.version}`, true);
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      console.error(`Registry verification attempt ${attempt + 1} failed; retrying without bypassing integrity checks`, error);
      await delay(30000);
    }
  }
} else throw new Error("Unknown service providers distribution command");
