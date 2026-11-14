import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, copyFileSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { collectPagesPackages, coreVersions } from "./collect-pages-packages.mjs";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
export function policyIdentity() {
  return sha256(git("ls-tree", "-r", "HEAD", "--", ".github/workflows", "scripts"));
}
export function inputs() {
  return {
    format: "gik-samples-evidence/1",
    tree: git("rev-parse", "HEAD^{tree}"),
    policy: policyIdentity(),
    node: process.version,
    npmResolver: "11.19.0",
    platform: process.platform,
    architecture: process.arch,
    imageOS: process.env.ImageOS || "local",
    imageVersion: process.env.ImageVersion || "local",
    viteBase: process.env.VITE_BASE || "/gik-samples/",
    recipe: "site-build,typecheck,studio-test,distribution,standalone-finbook,mcp/1",
  };
}
export const fingerprint = () => sha256(JSON.stringify(inputs()));
export function componentsPackage() {
  const version = JSON.parse(readFileSync("package.json", "utf8")).dependencies["gik-components"];
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? "")) throw new Error("Components consumer requires an exact npm version");
  return { name: "gik-components", version };
}
export const selectedScope = (outputs) => JSON.stringify(Object.fromEntries(
  ["full", "finbook", "mcp"].map((key) => [key, outputs[key] === "true"])));
export function eligibleValidationRun(run, pr, repository, currentRun) {
  return String(run.id) !== String(currentRun) && run.event === "pull_request"
    && run.status === "completed" && run.conclusion === "success" && run.head_sha === pr.head.sha
    && run.path === ".github/workflows/ci.yml" && run.repository?.full_name === repository
    && run.head_repository?.full_name === repository
    && run.pull_requests?.some((candidate) => candidate.number === pr.number);
}
export function api(resource) {
  return JSON.parse(execFileSync("gh", ["api", resource], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }));
}
export function siteDigest(directory) {
  const files = [];
  function visit(path, relative = "") {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("Site artifact links forbidden");
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (name.includes("\\") || /[\x00-\x1f]/.test(name)) throw new Error("Unsafe site artifact path");
        visit(join(path, name), relative ? `${relative}/${name}` : name);
      }
    } else if (stat.isFile()) {
      const bytes = readFileSync(path);
      files.push([relative, bytes.length, sha256(bytes)]);
    } else throw new Error("Unsupported site artifact entry");
  }
  if (!lstatSync(directory).isDirectory()) throw new Error("Site artifact must be a directory");
  visit(directory);
  if (!files.some(([path]) => path === "index.html")) throw new Error("Site artifact must contain index.html");
  return sha256(JSON.stringify(files));
}
export function verifySite(directory, expectedDigest) {
  if (!/^[a-f0-9]{64}$/.test(expectedDigest || "") || siteDigest(directory) !== expectedDigest) {
    throw new Error("Site artifact digest mismatch");
  }
}
export function inspectTarball(path, expected) {
  const entries = execFileSync("tar", ["-tzf", path], { encoding: "utf8" }).trim().split(/\r?\n/);
  if (new Set(entries).size !== entries.length || entries.some((entry) => !entry.startsWith("package/") || entry.split("/").includes("..")
    || entry.includes("\\") || /[\x00-\x1f]/.test(entry))) throw new Error("Unsafe tarball paths");
  const details = execFileSync("tar", ["-tvzf", path], { encoding: "utf8" });
  if (details.split(/\r?\n/).some((line) => /^[lh]/.test(line))) throw new Error("Tarball links forbidden");
  const actual = JSON.parse(execFileSync("tar", ["-xOf", path, "package/package.json"], { encoding: "utf8" }));
  for (const key of ["name", "version", "exports", "dependencies", "peerDependencies"]) {
    if (Object.hasOwn(expected, key) && !isDeepStrictEqual(actual[key], expected[key])) throw new Error(`Packed ${key} differs from source`);
  }
  const leaves = (value) => typeof value === "string" ? [value]
    : value && typeof value === "object" ? Object.values(value).flatMap(leaves) : [];
  const exports = leaves(actual.exports);
  if (!exports.length) throw new Error("Package must declare exports");
  for (const target of exports) {
    if (!target.startsWith("./dist/") || !entries.includes(`package/${target.slice(2)}`)) {
      throw new Error(`Absent or unsafe declared export: ${target}`);
    }
  }
  return actual;
}
export function verifyCandidate(directory, { allowSameTree = false, siteDirectory } = {}) {
  const manifestBytes = readFileSync(`${directory}/candidate.json`);
  const manifest = JSON.parse(manifestBytes);
  const expected = componentsPackage();
  if (manifest.format !== "gik-samples-candidate/2" || !/^[a-f0-9]{40}$/.test(manifest.commit || "")
    || !/^[a-f0-9]{64}$/.test(manifest.siteSha256 || "")
    || manifest.fingerprint !== fingerprint()
    || manifest.tree !== git("rev-parse", "HEAD^{tree}")
    || (!allowSameTree && manifest.commit !== git("rev-parse", "HEAD"))
    || manifest.name !== expected.name || manifest.version !== expected.version) {
    throw new Error("Candidate source, version or input fingerprint mismatch");
  }
  const bytes = readFileSync(`${directory}/gik-components.tgz`);
  if (process.env.REQUIRE_DIGEST_HANDOFF === "true"
    && (!/^[a-f0-9]{64}$/.test(process.env.EXPECTED_TARBALL_SHA256 || "")
      || !/^[a-f0-9]{64}$/.test(process.env.EXPECTED_MANIFEST_SHA256 || ""))) {
    throw new Error("Missing validation digest handoff");
  }
  if ((process.env.EXPECTED_TARBALL_SHA256 && sha256(bytes) !== process.env.EXPECTED_TARBALL_SHA256)
    || (process.env.EXPECTED_MANIFEST_SHA256 && sha256(manifestBytes) !== process.env.EXPECTED_MANIFEST_SHA256)) {
    throw new Error("Candidate differs from digest handed off by validation");
  }
  if (manifest.sha256 !== sha256(bytes)
    || manifest.integrity !== `sha512-${createHash("sha512").update(bytes).digest("base64")}`) {
    throw new Error("Candidate tarball hash mismatch");
  }
  inspectTarball(`${directory}/gik-components.tgz`, expected);
  if (siteDirectory !== undefined) verifySite(siteDirectory, manifest.siteSha256);
  return manifest;
}
export async function writeCandidate() {
  const path = ".artifacts/candidate";
  mkdirSync(path, { recursive: true });
  const expected = componentsPackage();
  const root = JSON.parse(readFileSync("package.json", "utf8"));
  const manifest = await collectPagesPackages({
    componentsVersion: expected.version,
    versions: { ...coreVersions, "gik-service-providers": root.dependencies["gik-service-providers"] },
    outputDirectory: "src/browser-host/dist/vendor",
  });
  const published = manifest.packages.find(({ name }) => name === expected.name);
  const locked = JSON.parse(readFileSync("package-lock.json", "utf8")).packages["node_modules/gik-components"];
  if (locked?.version !== expected.version || locked.integrity !== published.integrity) throw new Error("Components archive differs from committed npm lock");
  const bytes = readFileSync(`src/browser-host/dist/vendor/${published.file}`);
  writeFileSync(`${path}/gik-components.tgz`, bytes);
  inspectTarball(`${path}/gik-components.tgz`, JSON.parse(readFileSync("node_modules/gik-components/package.json", "utf8")));
  writeFileSync(`${path}/candidate.json`, JSON.stringify({
    format: "gik-samples-candidate/2", commit: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"), fingerprint: fingerprint(),
    name: expected.name, version: expected.version,
    sha256: sha256(bytes), integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    siteSha256: siteDigest("src/browser-host/dist"),
  }, null, 2) + "\n");
}

function downloadArtifact(runId, repository, name, directory) {
  execFileSync("gh", ["run", "download", String(runId), "--repo", repository, "--name", name,
    "--dir", directory], { stdio: "pipe" });
}
function runArtifacts(readApi, repository, runId) {
  const artifacts = [];
  for (let page = 1; page <= 100; page++) {
    const response = readApi(`repos/${repository}/actions/runs/${runId}/artifacts?per_page=100&page=${page}`);
    if (!Array.isArray(response.artifacts) || !Number.isSafeInteger(response.total_count) || response.total_count < 0) {
      throw new Error("Invalid Actions artifact listing");
    }
    if (response.artifacts.some((artifact) => typeof artifact.name !== "string"
      || typeof artifact.expired !== "boolean" || !Number.isSafeInteger(artifact.id) || artifact.id <= 0)) {
      throw new Error("Malformed Actions artifact identity");
    }
    artifacts.push(...response.artifacts);
    if (artifacts.length >= response.total_count) return artifacts;
    if (!response.artifacts.length) throw new Error("Incomplete Actions artifact listing");
  }
  throw new Error("Actions artifact listing exceeded the bounded page limit");
}
export async function reuse(mode, {
  readApi = api, download = downloadArtifact, log = console.log, reuseRoot = ".artifacts",
} = {}) {
  if (mode !== "metadata") throw new Error("Unsupported evidence reuse mode; package release promotion was retired");
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const repository = process.env.GITHUB_REPOSITORY;
  if (!["labeled", "unlabeled", "edited"].includes(event.action)) return false;
  if (/^release:/.test(event.label?.name || "")) return false;
  for (const pr of [event.pull_request]) {
    if (pr?.head?.repo?.full_name !== repository) {
      log("Reuse fallback: PR repository identity differs");
      continue;
    }
    const runs = readApi(`repos/${repository}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pr.head.sha}&status=success&per_page=30`).workflow_runs;
    for (const run of runs) {
      if (!eligibleValidationRun(run, pr, repository, process.env.GITHUB_RUN_ID)) {
        log(`Reuse fallback: CI run ${run.id} identity is ineligible`);
        continue;
      }
      const names = ["validation-evidence"];
      const artifacts = runArtifacts(readApi, repository, run.id);
      let missing = false;
      for (const name of names) {
        const available = artifacts.filter((artifact) => artifact.name === name && artifact.expired === false);
        if (available.length > 1) throw new Error(`Ambiguous Actions artifact: ${name}`);
        if (!available.length) {
          log(`Reuse cache miss: CI run ${run.id} artifact ${name} is absent or expired`);
          missing = true;
        }
      }
      if (missing) continue;
      const directory = `${reuseRoot}/reuse-${run.id}`;
      download(run.id, repository, names[0], directory);
      const evidence = JSON.parse(readFileSync(`${directory}/validation.json`, "utf8"));
      if (typeof evidence.format !== "string" || !/^[a-f0-9]{64}$/.test(evidence.fingerprint || "")
        || typeof evidence.scope !== "string") throw new Error("Malformed validation evidence");
      const scope = JSON.parse(evidence.scope);
      if (!scope || Object.keys(scope).sort().join(",") !== "finbook,full,mcp"
        || Object.values(scope).some((value) => typeof value !== "boolean")) throw new Error("Malformed validation scope");
      if (evidence.fingerprint !== fingerprint() || evidence.format !== "gik-samples-validation/1") {
        log(`Reuse fallback: CI run ${run.id} validation input identity differs`);
        continue;
      }
      if (!isDeepStrictEqual(scope, JSON.parse(selectedScope(JSON.parse(process.env.VALIDATION_SCOPE || "{}"))))) {
        log(`Reuse fallback: CI run ${run.id} selected validation scope differs`);
        continue;
      }
      if (evidence.validated !== true) throw new Error("Matching validation evidence is incomplete");
      log(`Reused ${mode} evidence from CI run ${run.id}`);
      appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `Reused ${mode} evidence: https://github.com/${repository}/actions/runs/${run.id}\n`);
      return true;
    }
  }
  return false;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  if (command === "pack") await writeCandidate();
  else if (command === "verify") verifyCandidate(".artifacts/candidate", { allowSameTree: process.env.ALLOW_SAME_TREE === "true" });
  else if (command === "verify-site") verifyCandidate(".artifacts/candidate", { siteDirectory: "src/browser-host/dist" });
  else if (command === "hashes") {
    verifyCandidate(".artifacts/candidate", { siteDirectory: "src/browser-host/dist" });
    for (const [key, file] of [["tarball_sha256", "gik-components.tgz"], ["manifest_sha256", "candidate.json"]]) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${sha256(readFileSync(`.artifacts/candidate/${file}`))}\n`);
    }
  }
  else if (command === "reuse") {
    const reused = await reuse(process.argv[3]);
    appendFileSync(process.env.GITHUB_OUTPUT, `reused=${reused}\n`);
  } else if (command === "record") {
    mkdirSync(".artifacts/validation", { recursive: true });
    writeFileSync(".artifacts/validation/validation.json", JSON.stringify({
      format: "gik-samples-validation/1", fingerprint: fingerprint(), inputs: inputs(), validated: true,
      scope: selectedScope(JSON.parse(process.env.RESULTS).plan.outputs),
    }));
  } else if (command === "policy") console.log(policyIdentity());
  else throw new Error("Unknown evidence command");
}
