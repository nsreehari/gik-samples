import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  eligibleValidationRun, fingerprint, git, hasHeadApproval, inspectTarball, policyIdentity, reuse, sha256, verifyCandidate,
} from "../actions-evidence.mjs";
import { assertLanes } from "../validate-lanes.mjs";
import {
  assertVerificationRun, DEFAULT_GIK_VERIFICATION_JOB, newer, updateManifest, validateManifest, waitForVerificationRun,
} from "../verified-gik-update.mjs";
import { serveFile } from "../static-preview.mjs";
import { assertProvenance } from "../npm-provenance.mjs";
import { checkLocks } from "../check-locks.mjs";
import { shouldPublish } from "../publish-candidate.mjs";
import { planRelease, releaseInputsAt } from "../plan-release.mjs";
import { coreVersions } from "../collect-pages-packages.mjs";

const source = "nsreehari/generative-interaction-kernel";
const manifest = {
  format: "gik-release-manifest/1", repository: source, commit: "a".repeat(40),
  tag: "v1.2.3", verificationRunId: "123",
  packages: [{ name: "gik-kernel", version: "1.2.3", integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
    tarball: "https://registry.npmjs.org/gik-kernel/-/gik-kernel-1.2.3.tgz" }],
};
function fixture(t) {
  mkdirSync(".artifacts/test-fixtures", { recursive: true });
  const directory = mkdtempSync(resolve(".artifacts/test-fixtures/case-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
test("required aggregate rejects failed, cancelled and inappropriately skipped selected lanes", () => {
  const needs = {
    plan: { result: "success", outputs: { full: "true", finbook: "true", mcp: "false", reused: "false" } },
    studio: { result: "success" }, finbook: { result: "success" }, mcp: { result: "skipped" },
  };
  assert.doesNotThrow(() => assertLanes(needs));
  for (const result of ["failure", "cancelled", "skipped"]) {
    assert.throws(() => assertLanes({ ...needs, studio: { result } }), /studio/);
  }
  assert.throws(() => assertLanes({ ...needs, plan: { ...needs.plan, result: "failure" } }), /Planning/);
  assert.throws(() => assertLanes({ ...needs, mcp: { result: "failure" } }), /mcp/);
  assert.throws(() => assertLanes({
    ...needs, plan: { ...needs.plan, outputs: { ...needs.plan.outputs, full: "" } },
  }), /planning selector/);
  assert.doesNotThrow(() => assertLanes({
    ...needs, plan: { ...needs.plan, outputs: { ...needs.plan.outputs, reused: "true" } },
    studio: { result: "skipped" }, finbook: { result: "skipped" },
  }));
});
test("release promotion is off by default, rejects unreviewed policy and does not reuse release-intent metadata", async (t) => {
  const directory = fixture(t);
  const keys = ["GITHUB_EVENT_PATH", "REUSE_ENABLED", "REVIEWED_POLICY"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.GITHUB_EVENT_PATH = `${directory}/event.json`;
    writeFileSync(process.env.GITHUB_EVENT_PATH, "{}");
    process.env.REUSE_ENABLED = "false";
    process.env.REVIEWED_POLICY = policyIdentity();
    assert.equal(await reuse("release"), false);
    process.env.REUSE_ENABLED = "true";
    process.env.REVIEWED_POLICY = "not-the-reviewed-policy";
    assert.equal(await reuse("release"), false);
    writeFileSync(process.env.GITHUB_EVENT_PATH, JSON.stringify({ action: "labeled", label: { name: "release:minor" } }));
    assert.equal(await reuse("metadata"), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
test("PR evidence requires the same internal successful workflow run and associated PR head", () => {
  const repository = "nsreehari/gik-samples";
  const pr = { number: 42, head: { sha: "b".repeat(40) } };
  const run = { id: 123, event: "pull_request", status: "completed", conclusion: "success",
    head_sha: pr.head.sha, path: ".github/workflows/ci.yml",
    repository: { full_name: repository }, head_repository: { full_name: repository },
    pull_requests: [{ number: pr.number }] };
  assert.equal(eligibleValidationRun(run, pr, repository, "456"), true);
  for (const patch of [
    { event: "workflow_dispatch" }, { status: "in_progress" }, { conclusion: "cancelled" },
    { path: ".github/workflows/other.yml" }, { head_sha: "c".repeat(40) },
    { repository: { full_name: "attacker/repo" } }, { head_repository: { full_name: "attacker/fork" } },
    { pull_requests: [{ number: 43 }] },
  ]) assert.equal(eligibleValidationRun({ ...run, ...patch }, pr, repository, "456"), false);
  assert.equal(eligibleValidationRun(run, pr, repository, "123"), false);
});
test("release promotion needs a current trusted human approval, not a stale, dismissed or bot review", () => {
  const head = "b".repeat(40);
  const approved = { user: { id: 1, type: "User" }, author_association: "OWNER", state: "APPROVED", commit_id: head };
  assert.equal(hasHeadApproval([approved], head), true);
  assert.equal(hasHeadApproval([{ ...approved, commit_id: "c".repeat(40) }], head), false);
  assert.equal(hasHeadApproval([{ ...approved, user: { id: 1, type: "Bot" } }], head), false);
  assert.equal(hasHeadApproval([{ ...approved, author_association: "NONE" }], head), false);
  for (const state of ["DISMISSED", "CHANGES_REQUESTED"]) {
    assert.equal(hasHeadApproval([approved, { ...approved, state }], head), false);
  }
  assert.equal(hasHeadApproval([approved, { ...approved, user: { id: 2, type: "User" }, state: "CHANGES_REQUESTED" }], head), false);
  assert.equal(hasHeadApproval(Array(100).fill(approved), head), false);
});
test("upstream manifest rejects shell data, mutable versions, duplicate packages and non-registry archives", () => {
  assert.doesNotThrow(() => validateManifest(manifest));
  for (const patch of [
    { repository: "attacker/repo" }, { commit: "main" }, { tag: "../bad" }, { verificationRunId: "1;echo bad" },
    { packages: [manifest.packages[0], manifest.packages[0]] },
    { packages: [{ ...manifest.packages[0], version: "latest" }] },
    { packages: [{ ...manifest.packages[0], tarball: "https://example.test/a.tgz" }] },
  ]) assert.throws(() => validateManifest({ ...manifest, ...patch }));
});
test("successful run identity and exact consumer verification job are required independently of manifest metadata", () => {
  const run = { repository: { full_name: source }, head_repository: { full_name: source },
    path: ".github/workflows/publish.yml", event: "release", head_sha: manifest.commit,
    status: "completed", conclusion: "success" };
  const jobs = [{ name: "Clean npm verification", conclusion: "success" }];
  assert.doesNotThrow(() => assertVerificationRun(run, manifest, jobs, jobs[0].name));
  for (const patch of [
    { event: "workflow_dispatch" }, { path: ".github/workflows/untrusted.yml" },
    { head_sha: "b".repeat(40) }, { conclusion: "failure" },
    { head_repository: { full_name: "attacker/fork" } },
  ]) assert.throws(() => assertVerificationRun({ ...run, ...patch }, manifest, jobs, jobs[0].name));
  assert.throws(() => assertVerificationRun(run, manifest, [], jobs[0].name));
  assert.throws(() => assertVerificationRun(run, manifest, jobs, ""));
  assert.doesNotThrow(() => assertVerificationRun(run, manifest,
    [{ name: DEFAULT_GIK_VERIFICATION_JOB, conclusion: "success" }]));
  assert.throws(() => assertVerificationRun(run, manifest, jobs));
});
test("upstream announce race waits for completion but never treats in-progress or failed runs as success", async () => {
  let calls = 0;
  const pauses = [];
  const completed = await waitForVerificationRun(manifest, async () =>
    ++calls < 3 ? { status: "in_progress" } : { status: "completed", conclusion: "success" },
  async (ms) => pauses.push(ms));
  assert.equal(completed.conclusion, "success");
  assert.deepEqual(pauses, [10_000, 10_000]);
  assert.equal((await waitForVerificationRun(manifest,
    async () => ({ status: "completed", conclusion: "failure" }))).conclusion, "failure");
  let pendingCalls = 0;
  await assert.rejects(waitForVerificationRun(manifest,
    async () => { pendingCalls++; return { status: "in_progress" }; }, async () => {}), /bounded verification wait/);
  assert.equal(pendingCalls, 7);
});
test("dependency plan raises known minima/pins without downgrades, workspace replacement or unrelated metadata edits", () => {
  const before = { name: "sample", version: "0.1.0", scripts: { build: "unchanged" },
    dependencies: { "gik-kernel": ">=0.4.1", "gik-components": "file:packages/components", react: "^18.3.1" },
    overrides: { "gik-kernel": "$gik-kernel" } };
  const result = updateManifest(before, manifest.packages);
  assert.equal(result.dependencies["gik-kernel"], ">=1.2.3");
  assert.equal(result.dependencies["gik-components"], "file:packages/components");
  assert.deepEqual(result.scripts, before.scripts);
  assert.deepEqual(result.overrides, before.overrides);
  assert.equal(before.dependencies["gik-kernel"], ">=0.4.1");
  assert.deepEqual(updateManifest(result, [{ ...manifest.packages[0], version: "1.0.0" }]), result);
  assert.equal(newer("10.0.0", "9.99.99"), true);
  assert.throws(() => updateManifest({ dependencies: { "gik-kernel": "*" } }, manifest.packages));
});
test("the actual packed archive must contain every declared export and match the source manifest", (t) => {
  const directory = fixture(t);
  mkdirSync(`${directory}/package/dist`, { recursive: true });
  const pkg = { name: "gik-components", version: "1.0.0", exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } } };
  writeFileSync(`${directory}/package/package.json`, JSON.stringify(pkg));
  writeFileSync(`${directory}/package/dist/index.js`, "export {};");
  const archive = `${directory}/candidate.tgz`;
  const pack = () => execFileSync("tar", ["-czf", archive, "-C", directory, "package"]);
  pack();
  assert.throws(() => inspectTarball(archive, pkg), /Absent/);
  writeFileSync(`${directory}/package/dist/index.d.ts`, "export {};");
  pack();
  assert.deepEqual(inspectTarball(archive, pkg), pkg);
  assert.throws(() => inspectTarball(archive, { ...pkg, version: "1.0.1" }), /version/);
});
test("candidate verification rejects source, byte and independently handed-off digest mismatches", (t) => {
  const directory = fixture(t);
  const pkg = JSON.parse(readFileSync("packages/components/package.json", "utf8"));
  mkdirSync(`${directory}/package/dist`, { recursive: true });
  writeFileSync(`${directory}/package/package.json`, JSON.stringify(pkg));
  for (const target of Object.values(pkg.exports).flatMap(Object.values)) {
    writeFileSync(`${directory}/package/${target.slice(2)}`, "export {};");
  }
  const path = `${directory}/gik-components.tgz`;
  execFileSync("tar", ["-czf", path, "-C", directory, "package"]);
  const bytes = readFileSync(path);
  const candidate = {
    format: "gik-samples-candidate/2", commit: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}"),
    fingerprint: fingerprint(), name: pkg.name, version: pkg.version, sha256: sha256(bytes),
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    siteSha256: "a".repeat(64),
  };
  const save = (value) => writeFileSync(`${directory}/candidate.json`, JSON.stringify(value));
  save(candidate);
  assert.doesNotThrow(() => verifyCandidate(directory));
  save({ ...candidate, commit: "a".repeat(40) });
  assert.throws(() => verifyCandidate(directory), /source/);
  save(candidate);
  const previous = process.env.REQUIRE_DIGEST_HANDOFF;
  const previousDigest = process.env.EXPECTED_TARBALL_SHA256;
  const previousManifest = process.env.EXPECTED_MANIFEST_SHA256;
  try {
    process.env.REQUIRE_DIGEST_HANDOFF = "true";
    delete process.env.EXPECTED_TARBALL_SHA256;
    delete process.env.EXPECTED_MANIFEST_SHA256;
    assert.throws(() => verifyCandidate(directory), /Missing validation digest/);
    process.env.EXPECTED_TARBALL_SHA256 = "b".repeat(64);
    process.env.EXPECTED_MANIFEST_SHA256 = sha256(readFileSync(`${directory}/candidate.json`));
    assert.throws(() => verifyCandidate(directory), /digest handed off/);
  } finally {
    for (const [key, value] of Object.entries({
      REQUIRE_DIGEST_HANDOFF: previous, EXPECTED_TARBALL_SHA256: previousDigest, EXPECTED_MANIFEST_SHA256: previousManifest,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  writeFileSync(path, Buffer.concat([bytes, Buffer.from("tampered")]));
  assert.throws(() => verifyCandidate(directory), /hash mismatch/);
});
test("evidence fingerprint invalidates different deployment bases and runner images", () => {
  const base = process.env.VITE_BASE, image = process.env.ImageVersion;
  try {
    process.env.VITE_BASE = "/gik-samples/";
    process.env.ImageVersion = "image-one";
    const before = fingerprint();
    process.env.VITE_BASE = "/different/";
    assert.notEqual(fingerprint(), before);
    process.env.VITE_BASE = "/gik-samples/";
    process.env.ImageVersion = "image-two";
    assert.notEqual(fingerprint(), before);
  } finally {
    if (base === undefined) delete process.env.VITE_BASE; else process.env.VITE_BASE = base;
    if (image === undefined) delete process.env.ImageVersion; else process.env.ImageVersion = image;
  }
});
test("dependency-free smoke preview respects nested base, CSS MIME type and path containment", async (t) => {
  const root = fixture(t);
  writeFileSync(`${root}/index.html`, "site");
  writeFileSync(`${root}/site.css`, "body{}");
  assert.equal((await serveFile(root, "/gik-samples/", "/gik-samples/")).bytes.toString(), "site");
  assert.equal((await serveFile(root, "/gik-samples/", "/gik-samples/site.css")).contentType, "text/css");
  await assert.rejects(serveFile(root, "/gik-samples/", "/elsewhere/index.html"));
  await assert.rejects(serveFile(root, "/gik-samples/", "/gik-samples/../outside"));
});
test("resolution guard rejects absent, stale and mismatched workspace locks without installing", (t) => {
  const directory = fixture(t);
  assert.throws(() => checkLocks(directory), /Missing reproducible lock/);
  for (const [prefix, workspaces] of [
    ["", ["packages/components"]], ["apps/finbook", ["reference-app-host/browser-host", "mcp-server"]],
    ["packages/mcp-server", []],
  ]) {
    const packages = {};
    for (const workspace of ["", ...workspaces]) {
      mkdirSync(`${directory}/${prefix}/${workspace}`, { recursive: true });
      const pkg = { name: "fixture", version: "1.0.0", dependencies: { a: "1.0.0", b: "2.0.0" } };
      writeFileSync(`${directory}/${prefix}/${workspace}/package.json`, JSON.stringify(pkg));
      packages[workspace] = { ...pkg, dependencies: { b: "2.0.0", a: "1.0.0" } };
    }
    writeFileSync(`${directory}/${prefix}/package-lock.json`, JSON.stringify({ lockfileVersion: 3, packages }));
  }
  assert.doesNotThrow(() => checkLocks(directory));
  const lock = `${directory}/package-lock.json`;
  const value = JSON.parse(readFileSync(lock, "utf8"));
  value.packages["packages/components"].version = "1.0.1";
  writeFileSync(lock, JSON.stringify(value));
  assert.throws(() => checkLocks(directory), /workspace version/);
});
test("signature validation is supplemented by expected npm provenance source and publishing policy", () => {
  const predicateType = "https://slsa.dev/provenance/v1";
  const evidence = (commit, repository = source, path = ".github/workflows/publish.yml") => ({
    attestations: [{ predicateType, bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify({
      predicateType, predicate: { buildDefinition: {
        externalParameters: { workflow: { repository: `https://github.com/${repository}`, path } },
        resolvedDependencies: [{ uri: `git+https://github.com/${repository}@refs/tags/v1.2.3`, digest: { gitCommit: commit } }],
      } },
    })).toString("base64") } } }],
  });
  assert.doesNotThrow(() => assertProvenance(evidence(manifest.commit), source, manifest.commit));
  assert.throws(() => assertProvenance(evidence("b".repeat(40)), source, manifest.commit));
  assert.throws(() => assertProvenance(evidence(manifest.commit, "attacker/fork"), source, manifest.commit));
  assert.throws(() => assertProvenance(evidence(manifest.commit, source, ".github/workflows/other.yml"), source, manifest.commit));
  assert.throws(() => assertProvenance({ attestations: [] }, source, manifest.commit));
});
test("publication retries skip only an exact already-published candidate and reject version collisions", () => {
  const candidate = { name: "gik-components", version: "1.0.0", integrity: "sha512-test" };
  assert.equal(shouldPublish(null, candidate), true);
  const existing = { name: candidate.name, version: candidate.version, dist: { integrity: candidate.integrity } };
  assert.equal(shouldPublish(existing, candidate), false);
  assert.throws(() => shouldPublish({ ...existing, version: "1.0.1" }, candidate));
  assert.throws(() => shouldPublish({ ...existing, dist: { integrity: "sha512-other" } }, candidate));
});
test("one canonical release owns version-changing pushes, pins rollback and checks tag/main/channel", () => {
  const sha = "a".repeat(40);
  const runGit = (command, ref) => {
    if (command === "rev-parse") return sha;
    if (command === "merge-base") return "";
    if (command === "show") return JSON.stringify({ version: ref.startsWith("before:") ? "0.3.0" : "0.3.1" });
    throw new Error("Unexpected git call");
  };
  assert.equal(planRelease({ kind: "push", sha, event: { before: "before", after: "after" } }, runGit).pages, false);
  assert.equal(planRelease({ kind: "push", sha, event: { before: "same", after: "after" } }, runGit).pages, true);
  const event = { release: { tag_name: "components-v0.3.1", draft: false, prerelease: false } };
  assert.deepEqual(planRelease({ kind: "release", sha, event }, runGit),
    { commit: sha, version: "0.3.1", channel: "latest", pages: true, publish: true });
  assert.throws(() => planRelease({ kind: "release", sha, event: { release: { ...event.release, prerelease: true } } }, runGit));
  assert.throws(() => planRelease({ kind: "release", sha, event }, (command, ref) =>
    command === "rev-parse" && ref === "origin/main" ? "b".repeat(40) : runGit(command, ref)));
  for (const releaseRef of ["main", "latest", "bad; echo bad", "a".repeat(39)]) {
    assert.throws(() => planRelease({ kind: "workflow_dispatch", event: {}, releaseRef }, runGit));
  }
  assert.equal(planRelease({ kind: "workflow_dispatch", event: {}, releaseRef: sha }, runGit).publish, false);
});
test("rollback collection uses exact pinned source constraints and core versions, never current mutable package selection", () => {
  const documents = {
    "package.json": { version: "0.0.0", dependencies: { react: "^18.3.1" } },
    "packages/components/package.json": { version: "0.3.1" },
    "package-lock.json": { lockfileVersion: 3, packages: {
      "": { version: "0.0.0", dependencies: { react: "^18.3.1" } },
      "packages/components": { version: "0.3.1" },
    } },
    "scripts/pages-core-versions.json": { ...coreVersions, "gik-kernel": "0.99.0" },
  };
  const readGit = (_, ref) => JSON.stringify(documents[ref.slice(ref.indexOf(":") + 1)]);
  assert.equal(releaseInputsAt(manifest.commit, readGit)["gik-kernel"], "0.99.0");
  documents["package-lock.json"].packages["packages/components"].version = "0.3.0";
  assert.throws(() => releaseInputsAt(manifest.commit, readGit), /matching committed root lock/);
  documents["package-lock.json"].packages["packages/components"].version = "0.3.1";
  documents["scripts/pages-core-versions.json"]["gik-kernel"] = "latest";
  assert.throws(() => releaseInputsAt(manifest.commit, readGit), /exact structured core versions/);
});
test("maintenance lock generation has manual/reusable entrypoints, stays read-only and uploads only three locks", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/dependency-locks.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(workflow, /on:\s+workflow_dispatch:\s+workflow_call:\s+permissions:\s+contents: read/);
  assert.match(workflow, /node-version: 24/);
  assert.equal((workflow.match(/npm exec --yes --package=npm@11\.19\.0 -- npm install/g) || []).length, 3);
  assert.equal((workflow.match(/--package-lock-only --ignore-scripts --no-audit --no-fund/g) || []).length, 3);
  assert.match(workflow, /node scripts\/check-locks\.mjs/);
  const paths = workflow.match(/path: \|\n((?: +[^\n]+\n)+?) +if-no-files-found:/)[1]
    .trim().split(/\r?\n/).map((value) => value.trim());
  assert.deepEqual(paths, ["package-lock.json", "apps/finbook/package-lock.json", "packages/mcp-server/package-lock.json"]);
  assert.doesNotMatch(workflow, /secrets\.|id-token:|contents: write|environment:|npm publish|git push|gh pr|deploy-pages/);
});
test("registered CI lock bootstrap is explicit-manual-only and cannot bypass PR checks or emit validation evidence", () => {
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(ci, /generate_locks:[\s\S]*?type: boolean\s+default: false/);
  assert.match(ci, /generate-locks:\s+if: github\.event_name == 'workflow_dispatch' && inputs\.generate_locks == true\s+uses: \.\/\.github\/workflows\/dependency-locks\.yml/);
  const guard = "github.event_name != 'workflow_dispatch' || inputs.generate_locks != true";
  assert.equal(ci.split(guard).length - 1, 5);
  assert.match(ci, /plan:\s+if: github\.event_name != 'workflow_dispatch' \|\| inputs\.generate_locks != true/);
  assert.match(ci, /name: validate\s+if: always\(\) && \(github\.event_name != 'workflow_dispatch' \|\| inputs\.generate_locks != true\)/);
});
test("release DAG gates exact collection on publication; validation uses isolated, mandatory lanes", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/publish.yml", import.meta.url), "utf8");
  assert.match(workflow, /needs: \[plan, validate, publish, verify-registry, site\]/);
  assert.match(workflow, /needs\.publish\.result == 'success'/);
  assert.match(workflow, /needs\.verify-registry\.result == 'success'/);
  assert.match(workflow, /PAGES_COMPONENTS_VERSION: \$\{\{ needs\.plan\.outputs\.version \}\}/);
  assert.match(workflow, /run: node scripts\/publish-candidate\.mjs/);
  const publisher = readFileSync(new URL("../publish-candidate.mjs", import.meta.url), "utf8");
  assert.match(publisher, /"publish", "\.artifacts\/candidate\/gik-components\.tgz", "--ignore-scripts"/);
  assert.doesNotMatch(workflow, /workflow run publish|PAGES_COMPONENTS_VERSION:.*latest|npm publish --workspace/);
  assert.match(workflow, /group: components-publication[\s\S]*?cancel-in-progress: false/);
  assert.match(workflow, /group: pages-deployment/);
  assert.match(workflow, /deploy-pages:\s+name: Deploy Pages\s+needs: collect-pages\s+if: always\(\) && needs\.collect-pages\.result == 'success'/);
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /name: validate\s+if: always\(\)/);
  assert.match(ci, /needs: \[plan, studio, finbook, mcp\]/);
  const lanes = readFileSync(new URL("../../.github/workflows/validation-lane.yml", import.meta.url), "utf8");
  assert.match(lanes, /git archive HEAD:apps\/finbook/);
  assert.match(lanes, /npm test -- --exclude 'apps\/finbook\/\*\*'/);
  assert.doesNotMatch(lanes, /path:.*node_modules/);
});
