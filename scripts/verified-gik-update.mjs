import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { api, git, sha256 } from "./actions-evidence.mjs";
import { coreVersions } from "./collect-pages-packages.mjs";
import { provenanceSourceCommit, fetchProvenance } from "./npm-provenance.mjs";
import { checkLocks } from "./check-locks.mjs";

const source = "nsreehari/generative-interaction-kernel";
export const DEFAULT_GIK_VERIFICATION_JOB = "Verify published stable packages / Consume published packages";
export function assertReleasedProvenance(attestation, releaseCommit, readApi = api, comparisons = new Map()) {
  if (!/^[a-f0-9]{40}$/.test(releaseCommit || "")) throw new Error("Expected exact GIK release commit");
  const publishedCommit = provenanceSourceCommit(attestation, source);
  if (publishedCommit === releaseCommit) return publishedCommit;
  const key = `${publishedCommit}...${releaseCommit}`;
  if (!comparisons.has(key)) comparisons.set(key, readApi(`repos/${source}/compare/${key}`));
  const comparison = comparisons.get(key);
  if (!["ahead", "identical"].includes(comparison.status) || comparison.merge_base_commit?.sha !== publishedCommit) {
    throw new Error("Verified package provenance source is not an ancestor of the declared GIK release");
  }
  return publishedCommit;
}
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function newer(a, b) {
  if (!versionPattern.test(a) || !versionPattern.test(b)) throw new Error("Stable exact versions required");
  const left = a.split(".").map(BigInt), right = b.split(".").map(BigInt);
  const index = left.findIndex((value, i) => value !== right[i]);
  return index >= 0 && left[index] > right[index];
}
export function validateManifest(manifest) {
  if (manifest.format !== "gik-release-manifest/1" || manifest.repository !== source
    || !/^[a-f0-9]{40}$/.test(manifest.commit) || !/^[1-9]\d*$/.test(manifest.verificationRunId)
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(manifest.tag)
    || !Array.isArray(manifest.packages) || !manifest.packages.length || manifest.packages.length > 100) {
    throw new Error("Invalid verified GIK release manifest");
  }
  const seen = new Set();
  for (const pkg of manifest.packages) {
    if (!/^gik-[a-z0-9-]+$/.test(pkg.name) || seen.has(pkg.name) || !versionPattern.test(pkg.version)
      || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.integrity)
      || pkg.tarball !== `https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz`) {
      throw new Error("Invalid or duplicate manifest package");
    }
    seen.add(pkg.name);
  }
  return manifest;
}
export function updateManifest(original, packages) {
  const updated = structuredClone(original);
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "overrides"]) {
    for (const [name, range] of Object.entries(updated[section] || {})) {
      const pkg = packages.find((entry) => entry.name === name);
      if (!pkg || typeof range !== "string" || range.startsWith("$")) continue;
      const match = /^(>=|\^|~)?(\d+\.\d+\.\d+)$/.exec(range);
      if (!match) throw new Error(`Unsupported published dependency range: ${name}: ${range}`);
      if (newer(pkg.version, match[2])) updated[section][name] = `${match[1] || ""}${pkg.version}`;
    }
  }
  return updated;
}
export function assertVerificationRun(run, manifest, jobs, verificationJob = DEFAULT_GIK_VERIFICATION_JOB) {
  if (run.repository?.full_name !== source || run.head_repository?.full_name !== source
    || run.path !== ".github/workflows/publish.yml" || run.event !== "release"
    || run.head_sha !== manifest.commit || run.status !== "completed" || run.conclusion !== "success") {
    throw new Error("Manifest was not produced by successful source publication verification");
  }
  if (!verificationJob || !jobs.some((job) => job.name === verificationJob && job.conclusion === "success")) {
    throw new Error(`Expected successful clean npm verification job: ${verificationJob || DEFAULT_GIK_VERIFICATION_JOB}`);
  }
}
export async function waitForVerificationRun(manifest, readRun = () =>
  api(`repos/${source}/actions/runs/${manifest.verificationRunId}`), pause = delay) {
  for (let attempt = 0; attempt < 7; attempt++) {
    const run = await readRun();
    if (run.status === "completed") return run;
    if (attempt === 6) throw new Error("Source publication has not completed after the bounded verification wait");
    console.log("Source announce job is still finishing; waiting for the full publication result.");
    await pause(10_000);
  }
}
async function verifiedSource(payload) {
  if (!/^[a-f0-9]{40}$/.test(payload.commit || "") || !/^[a-f0-9]{64}$/.test(payload.manifestSha256 || "")
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(payload.tag || "")) throw new Error("Invalid dispatch identity");
  const release = api(`repos/${source}/releases/tags/${encodeURIComponent(payload.tag)}`);
  if (release.draft || release.prerelease || release.tag_name !== payload.tag) throw new Error("Not a stable published source release");
  const assets = release.assets.filter((asset) => asset.name === "gik-release-manifest.json");
  if (assets.length !== 1 || assets[0].size > 1024 * 1024) throw new Error("Missing or ambiguous source manifest asset");
  const bytes = execFileSync("gh", ["api", `repos/${source}/releases/assets/${assets[0].id}`,
    "-H", "Accept: application/octet-stream"]);
  if (sha256(bytes) !== payload.manifestSha256) throw new Error("Release asset digest differs from dispatch");
  const manifest = validateManifest(JSON.parse(bytes.toString("utf8")));
  if (manifest.commit !== payload.commit || manifest.tag !== payload.tag) throw new Error("Manifest identity differs from dispatch");
  let tag = api(`repos/${source}/git/ref/tags/${encodeURIComponent(manifest.tag)}`).object;
  for (let depth = 0; tag.type === "tag" && depth < 5; depth++) tag = api(`repos/${source}/git/tags/${tag.sha}`).object;
  if (tag.type !== "commit" || tag.sha !== manifest.commit) throw new Error("Source tag does not resolve to manifest commit");
  const run = await waitForVerificationRun(manifest);
  const jobs = api(`repos/${source}/actions/runs/${manifest.verificationRunId}/jobs?per_page=100`).jobs;
  assertVerificationRun(run, manifest, jobs, process.env.GIK_VERIFICATION_JOB || DEFAULT_GIK_VERIFICATION_JOB);
  // Signatures/provenance are checked independently below, not inferred from the source artifact.
  return { manifest, digest: payload.manifestSha256 };
}
function npm(...args) {
  execFileSync("npm", ["exec", "--yes", "--package=npm@11.19.0", "--", "npm", ...args],
    { stdio: "inherit", shell: process.platform === "win32" });
}
const dependencyBranch = "automation/verified-gik-release";
function humanAction(reason) {
  throw new Error(`Dependency automation requires human action: ${reason}. Inspect the existing branch/PR; do not overwrite or force-update it.`);
}
export function automationBranchState({ ref, head, pulls, repository, bot, base, digest }) {
  if (!/^[a-z0-9-]+\[bot\]$/.test(bot || "")) humanAction("expected maintainer App identity is missing");
  const open = pulls.filter((pull) => pull.state === "open");
  if (open.length > 1) humanAction("multiple open dependency PRs");
  if (!ref) {
    if (open.length) humanAction("an open dependency PR has no matching branch");
    return { parents: [base], pull: undefined, noOp: false };
  }
  if (ref.ref !== `refs/heads/${dependencyBranch}` || ref.object.type !== "commit"
    || head.sha !== ref.object.sha || head.author?.login !== bot) humanAction("branch head is not the expected App-authored commit");
  const message = head.commit.message;
  const sources = [...message.matchAll(/^Source base: ([a-f0-9]{40})$/gm)];
  const digests = [...message.matchAll(/^Manifest SHA-256: ([a-f0-9]{64})$/gm)];
  if (message.split("\n")[0] !== "chore: update verified GIK dependencies"
    || sources.length !== 1 || digests.length !== 1
    || !head.parents.some((parent) => parent.sha === sources[0][1])) humanAction("branch head lacks valid automation/source-base markers");
  const pull = open[0] || [...pulls].sort((a, b) => b.number - a.number)[0];
  if (!pull || pull.user?.login !== bot || pull.head?.repo?.full_name !== repository
    || pull.head.ref !== dependencyBranch || pull.head.sha !== ref.object.sha
    || pull.base?.repo?.full_name !== repository || pull.base.ref !== "main"
    || (pull.state !== "open" && !(pull.state === "closed" && pull.merged_at))) {
    humanAction("PR state, author, branch or source identity changed");
  }
  return {
    parents: [...new Set([ref.object.sha, base])],
    pull: pull.state === "open" ? pull : undefined, sourceBase: sources[0][1],
    noOp: digests[0][1] === digest,
  };
}
export function proposeDependencyUpdate({ plan, repository, bot, baseTree }, { readApi = api, writeApi } = {}) {
  const post = writeApi || ((resource, body, method = "POST") => JSON.parse(execFileSync("gh",
    ["api", `repos/${repository}/${resource}`, "--method", method, "--input", "-"],
    { input: JSON.stringify(body), encoding: "utf8" })));
  const lookup = () => {
    const matches = readApi(`repos/${repository}/git/matching-refs/heads/${dependencyBranch}`)
      .filter((ref) => ref.ref === `refs/heads/${dependencyBranch}`);
    if (matches.length > 1) humanAction("ambiguous dependency branch refs");
    return matches[0];
  };
  const ref = lookup();
  const pulls = readApi(`repos/${repository}/pulls?state=all&head=${repository.split("/")[0]}:${dependencyBranch}&per_page=100`);
  const head = ref ? readApi(`repos/${repository}/commits/${ref.object.sha}`) : undefined;
  const state = automationBranchState({ ref, head, pulls, repository, bot, base: plan.base, digest: plan.digest });
  if (state.sourceBase && state.sourceBase !== plan.base) {
    const comparison = readApi(`repos/${repository}/compare/${state.sourceBase}...${plan.base}`);
    if (!["ahead", "identical"].includes(comparison.status)) humanAction("previous source base is not an ancestor of current main");
  }
  if (state.noOp) {
    console.log("This exact manifest is already proposed.");
    return;
  }
  const tree = post("git/trees", { base_tree: baseTree, tree: plan.files.map((file) => ({
    path: file.path, mode: "100644", type: "blob", content: file.content,
  })) });
  const commit = post("git/commits", { tree: tree.sha, parents: state.parents,
    message: `chore: update verified GIK dependencies\n\nSource base: ${plan.base}\nManifest SHA-256: ${plan.digest}\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` });
  if (readApi(`repos/${repository}/git/ref/heads/main`).object.sha !== plan.base) humanAction("main advanced; replan the dependency update");
  if (ref) {
    if (lookup()?.object.sha !== ref.object.sha) humanAction("branch advanced after planning");
    post(`git/refs/heads/${dependencyBranch}`, { sha: commit.sha, force: false }, "PATCH");
  } else post("git/refs", { ref: `refs/heads/${dependencyBranch}`, sha: commit.sha });
  const body = `Verified upstream release: https://github.com/${source}/releases/tag/${plan.manifest.tag}\n\n`
    + `Manifest SHA-256: ${plan.digest}\n\nVerification run: https://github.com/${source}/actions/runs/${plan.manifest.verificationRunId}\n\n`
    + `Packages:\n${plan.manifest.packages.map((pkg) => `- ${pkg.name}@${pkg.version}`).join("\n")}\n\n`
    + "Registry integrity, signatures and provenance were independently checked. Normal CI and review are required. No build outputs were consumed.";
  if (state.pull) post(`pulls/${state.pull.number}`, { title: "chore: update verified GIK dependencies", body }, "PATCH");
  else post("pulls", { title: "chore: update verified GIK dependencies", body, head: dependencyBranch, base: "main" });
}
async function plan() {
  checkLocks();
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const payload = event.client_payload || {
    tag: process.env.RELEASE_TAG, commit: process.env.RELEASE_COMMIT, manifestSha256: process.env.MANIFEST_SHA256,
  };
  const { manifest, digest } = await verifiedSource(payload);
  const releases = api(`repos/${source}/releases?per_page=100`)
    .filter((release) => !release.draft && !release.prerelease
      && release.assets.some((asset) => asset.name === "gik-release-manifest.json"))
    .sort((a, b) => b.published_at.localeCompare(a.published_at));
  if (releases[0]?.tag_name !== manifest.tag) {
    console.log("Obsolete release signal: a newer verified release asset is available; leaving the coalesced PR unchanged.");
    appendFileSync(process.env.GITHUB_OUTPUT, "changed=false\n");
    mkdirSync(".artifacts/update-plan", { recursive: true });
    writeFileSync(".artifacts/update-plan/obsolete.json", JSON.stringify({ digest, supersededBy: releases[0]?.tag_name }));
    return;
  }
  mkdirSync(".artifacts/gik-consumer", { recursive: true });
  writeFileSync(".artifacts/gik-consumer/package.json", JSON.stringify({ private: true, dependencies: {} }));
  const attestations = [];
  for (const pkg of manifest.packages) {
    const response = await fetch(`https://registry.npmjs.org/${pkg.name}/${pkg.version}`, { redirect: "error" });
    if (!response.ok) throw new Error(`Registry metadata HTTP ${response.status}`);
    const metadata = await response.json();
    if (metadata.name !== pkg.name || metadata.version !== pkg.version || metadata.dist?.integrity !== pkg.integrity
      || metadata.dist.tarball !== pkg.tarball || !metadata.dist.attestations?.provenance) {
      throw new Error(`Published package identity/integrity/provenance differs: ${pkg.name}`);
    }
    attestations.push(await fetchProvenance(metadata.dist));
  }
  npm("install", "--prefix", ".artifacts/gik-consumer", "--ignore-scripts", "--no-audit", "--no-fund",
    ...manifest.packages.map((pkg) => `${pkg.name}@${pkg.version}`));
  npm("audit", "signatures", "--prefix", ".artifacts/gik-consumer");
  const provenanceComparisons = new Map();
  for (const attestation of attestations) assertReleasedProvenance(attestation, manifest.commit, api, provenanceComparisons);
  const paths = git("ls-files", "*package.json").split("\n").filter((path) => path.endsWith("package.json"));
  const updates = [];
  for (const path of paths) {
    const before = JSON.parse(readFileSync(path, "utf8"));
    const after = updateManifest(before, manifest.packages);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      writeFileSync(path, JSON.stringify(after, null, 2) + "\n");
      updates.push(path);
    }
  }
  const versions = { ...coreVersions };
  for (const pkg of manifest.packages) {
    if (versions[pkg.name] && newer(pkg.version, versions[pkg.name])) versions[pkg.name] = pkg.version;
  }
  if (JSON.stringify(versions) !== JSON.stringify(coreVersions)) {
    writeFileSync("scripts/pages-core-versions.json", JSON.stringify(versions, null, 2) + "\n");
    updates.push("scripts/pages-core-versions.json");
  }
  if (updates.length) {
    for (const directory of [".", "apps/finbook", "packages/mcp-server"]) {
      npm("install", "--prefix", directory, "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund");
    }
  }
  checkLocks();
  const files = git("diff", "--name-only").split("\n").filter(Boolean).map((path) => {
    if (!paths.includes(path) && !["package-lock.json", "apps/finbook/package-lock.json",
      "packages/mcp-server/package-lock.json", "scripts/pages-core-versions.json"].includes(path)) throw new Error("Unexpected update path");
    const content = readFileSync(path, "utf8");
    return { path, content, sha256: sha256(content) };
  });
  mkdirSync(".artifacts/update-plan", { recursive: true });
  writeFileSync(".artifacts/update-plan/plan.json", JSON.stringify({
    format: "gik-samples-dependency-plan/1", base: git("rev-parse", "HEAD"), digest, manifest, files,
  }, null, 2) + "\n");
  const summary = `## Verified GIK dependency plan\n\nSource: ${source}@${manifest.commit}\n\nManifest SHA-256: ${digest}\n\n`
    + manifest.packages.map((pkg) => `- ${pkg.name}@${pkg.version}`).join("\n")
    + `\n\nChanged files:\n${files.map((file) => `- ${file.path}`).join("\n") || "(none; already current)"}\n`;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${files.length > 0}\n`);
}
function openPullRequest() {
  const plan = JSON.parse(readFileSync(".artifacts/update-plan/plan.json", "utf8"));
  const repository = process.env.GITHUB_REPOSITORY;
  if (plan.format !== "gik-samples-dependency-plan/1" || plan.base !== git("rev-parse", "HEAD")
    || !/^[a-f0-9]{64}$/.test(plan.digest)) throw new Error("Plan base or digest mismatch");
  validateManifest(plan.manifest);
  if (api(`repos/${repository}/git/ref/heads/main`).object.sha !== plan.base) throw new Error("main advanced; replan before applying");
  const manifests = git("ls-files", "*package.json").split("\n");
  const allowed = new Set([...manifests, "package-lock.json", "apps/finbook/package-lock.json",
    "packages/mcp-server/package-lock.json", "scripts/pages-core-versions.json"]);
  for (const file of plan.files) {
    if (!allowed.has(file.path) || sha256(file.content) !== file.sha256) throw new Error("Unapproved update content/path");
    const after = JSON.parse(file.content);
    if (manifests.includes(file.path)) {
      const expected = updateManifest(JSON.parse(readFileSync(file.path, "utf8")), plan.manifest.packages);
      if (JSON.stringify(after) !== JSON.stringify(expected)) throw new Error("Plan changed non-dependency manifest fields");
    } else if (file.path === "scripts/pages-core-versions.json") {
      const expected = { ...coreVersions };
      for (const pkg of plan.manifest.packages) if (expected[pkg.name] && newer(pkg.version, expected[pkg.name])) expected[pkg.name] = pkg.version;
      if (JSON.stringify(after) !== JSON.stringify(expected)) throw new Error("Unexpected Pages version changes");
    } else if (after.lockfileVersion !== 3) throw new Error("Expected npm v3 lockfile");
  }
  if (!plan.files.length) return;
  proposeDependencyUpdate({
    plan, repository, bot: process.env.EXPECTED_APP_BOT, baseTree: git("rev-parse", "HEAD^{tree}"),
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "plan") await plan();
  else if (process.argv[2] === "apply") openPullRequest();
  else throw new Error("Expected plan or apply");
}
