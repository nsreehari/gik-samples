import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

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
export const selectedScope = (outputs) => JSON.stringify(Object.fromEntries(
  ["full", "finbook", "mcp"].map((key) => [key, outputs[key] === "true"])));
export function hasHeadApproval(reviews, head) {
  if (reviews.length >= 100) return false;
  const latest = new Map();
  for (const review of reviews) {
    if (review.user?.type !== "User" || !["OWNER", "MEMBER", "COLLABORATOR"].includes(review.author_association)) continue;
    if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) latest.set(review.user.id, review);
  }
  return ![...latest.values()].some((review) => review.state === "CHANGES_REQUESTED")
    && [...latest.values()].some((review) => review.state === "APPROVED" && review.commit_id === head);
}
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
export function inspectTarball(path, expected) {
  const entries = execFileSync("tar", ["-tzf", path], { encoding: "utf8" }).trim().split(/\r?\n/);
  if (new Set(entries).size !== entries.length || entries.some((entry) => !entry.startsWith("package/") || entry.split("/").includes("..")
    || entry.includes("\\") || /[\x00-\x1f]/.test(entry))) throw new Error("Unsafe tarball paths");
  const details = execFileSync("tar", ["-tvzf", path], { encoding: "utf8" });
  if (details.split(/\r?\n/).some((line) => /^[lh]/.test(line))) throw new Error("Tarball links forbidden");
  const actual = JSON.parse(execFileSync("tar", ["-xOf", path, "package/package.json"], { encoding: "utf8" }));
  for (const key of ["name", "version", "exports", "dependencies", "peerDependencies"]) {
    if (!isDeepStrictEqual(actual[key], expected[key])) throw new Error(`Packed ${key} differs from source`);
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
export function verifyCandidate(directory, { allowSameTree = false } = {}) {
  const manifestBytes = readFileSync(`${directory}/candidate.json`);
  const manifest = JSON.parse(manifestBytes);
  const expected = JSON.parse(readFileSync("packages/components/package.json", "utf8"));
  if (manifest.format !== "gik-samples-candidate/1" || !/^[a-f0-9]{40}$/.test(manifest.commit || "")
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
  return manifest;
}
export function writeCandidate() {
  const path = ".artifacts/candidate";
  mkdirSync(path, { recursive: true });
  const expected = JSON.parse(readFileSync("packages/components/package.json", "utf8"));
  if (!process.env.npm_execpath || execFileSync(process.execPath, [process.env.npm_execpath, "--version"],
    { encoding: "utf8" }).trim() !== "11.19.0") throw new Error("Pack with the pinned npm 11.19.0 CLI");
  const result = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath,
    "pack", "--workspace", "gik-components", "--ignore-scripts", "--json", "--pack-destination", path],
  { encoding: "utf8" }))[0];
  // pack --ignore-scripts consumes the already validated build; prepack remains intact for developers.
  const bytes = readFileSync(`${path}/${result.filename}`);
  writeFileSync(`${path}/gik-components.tgz`, bytes);
  inspectTarball(`${path}/gik-components.tgz`, expected);
  writeFileSync(`${path}/candidate.json`, JSON.stringify({
    format: "gik-samples-candidate/1", commit: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"), fingerprint: fingerprint(),
    name: expected.name, version: expected.version,
    sha256: sha256(bytes), integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  }, null, 2) + "\n");
}

export async function reuse(mode) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const repository = process.env.GITHUB_REPOSITORY;
  const release = mode === "release";
  if (release && (process.env.REUSE_ENABLED !== "true"
    || process.env.REVIEWED_POLICY !== policyIdentity())) return false;
  if (!release && !["labeled", "unlabeled", "edited"].includes(event.action)) return false;
  if (!release && /^release:/.test(event.label?.name || "")) return false;
  const prs = release
    ? api(`repos/${repository}/commits/${git("rev-parse", "HEAD")}/pulls`)
    : [event.pull_request];
  for (const pr of prs) {
    if (!pr || pr.head.repo.full_name !== repository) continue;
    if (release) {
      if (!pr.merged_at || pr.merge_commit_sha !== git("rev-parse", "HEAD")) continue;
      const reviews = api(`repos/${repository}/pulls/${pr.number}/reviews?per_page=100`);
      if (!hasHeadApproval(reviews, pr.head.sha)) continue;
    }
    const runs = api(`repos/${repository}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pr.head.sha}&status=success&per_page=30`).workflow_runs;
    for (const run of runs) {
      if (!eligibleValidationRun(run, pr, repository, process.env.GITHUB_RUN_ID)) continue;
      try {
        const directory = `.artifacts/reuse-${run.id}`;
        execFileSync("gh", ["run", "download", String(run.id), "--repo", repository, "--name",
          release ? "release-candidate" : "validation-evidence", "--dir", directory], { stdio: "pipe" });
        if (release) {
          const candidate = verifyCandidate(directory, { allowSameTree: true });
          // A run's checked-out synthetic merge must be its recorded candidate source.
          const commit = api(`repos/${repository}/commits/${candidate.commit}`);
          if (commit.parents.length !== 2 || commit.parents[1].sha !== pr.head.sha
            || commit.commit.tree.sha !== inputs().tree) continue;
          execFileSync("node", ["-e", `require('node:fs').cpSync(${JSON.stringify(directory)},'.artifacts/candidate',{recursive:true})`]);
          execFileSync("gh", ["run", "download", String(run.id), "--repo", repository,
            "--name", "site-build", "--dir", "src/browser-host/dist"], { stdio: "pipe" });
        } else {
          const evidence = JSON.parse(readFileSync(`${directory}/validation.json`, "utf8"));
          if (evidence.fingerprint !== fingerprint() || evidence.format !== "gik-samples-validation/1"
            || evidence.validated !== true
            || evidence.scope !== selectedScope(JSON.parse(process.env.VALIDATION_SCOPE || "{}"))) continue;
        }
        console.log(`Reused ${mode} evidence from CI run ${run.id}`);
        appendFileSync(process.env.GITHUB_STEP_SUMMARY,
          `Reused ${mode} evidence: https://github.com/${repository}/actions/runs/${run.id}\n`);
        return true;
      } catch {
        // Expired/missing artifacts and incompatible evidence trigger fresh validation.
      }
    }
  }
  return false;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  if (command === "pack") writeCandidate();
  else if (command === "verify") verifyCandidate(".artifacts/candidate", { allowSameTree: process.env.ALLOW_SAME_TREE === "true" });
  else if (command === "hashes") {
    verifyCandidate(".artifacts/candidate");
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
