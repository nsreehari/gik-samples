import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  componentsPackage, fingerprint, git, policyIdentity, reuse, selectedScope, sha256, siteDigest, verifyCandidate, verifySite,
} from "../actions-evidence.mjs";
import { checkLocks } from "../check-locks.mjs";
import { previewErrorStatus } from "../static-preview.mjs";
import { assertProvenance, assertPublicationSource, provenanceSourceCommit } from "../npm-provenance.mjs";
import { assertReleasedProvenance, automationBranchState, proposeDependencyUpdate } from "../verified-gik-update.mjs";

function fixture(t) {
  mkdirSync(".artifacts/safety-tests", { recursive: true });
  const directory = mkdtempSync(resolve(".artifacts/safety-tests/case-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function environment(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}
function candidateFixture(t) {
  const root = fixture(t);
  const directory = `${root}/candidate`, site = `${root}/site`;
  mkdirSync(`${directory}/package/dist`, { recursive: true });
  mkdirSync(`${site}/assets`, { recursive: true });
  writeFileSync(`${site}/index.html`, "<html>verified</html>");
  writeFileSync(`${site}/assets/main.js`, "export {};");
  writeFileSync(`${site}/.nojekyll`, "");
  const pkg = { ...componentsPackage(), exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } } };
  writeFileSync(`${directory}/package/package.json`, JSON.stringify(pkg));
  for (const target of Object.values(pkg.exports).flatMap(Object.values)) {
    writeFileSync(`${directory}/package/${target.slice(2)}`, "export {};");
  }
  execFileSync("tar", ["-czf", `${directory}/gik-components.tgz`, "-C", directory, "package"]);
  const bytes = readFileSync(`${directory}/gik-components.tgz`);
  const candidate = {
    format: "gik-samples-candidate/2", commit: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}"),
    fingerprint: fingerprint(), name: pkg.name, version: pkg.version, sha256: sha256(bytes),
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`, siteSha256: siteDigest(site),
  };
  writeFileSync(`${directory}/candidate.json`, JSON.stringify(candidate));
  return { directory, site, candidate };
}
function reuseFixture(t, release = false) {
  const root = fixture(t), repository = "nsreehari/gik-samples";
  const pr = { number: 42, head: { sha: "b".repeat(40), repo: { full_name: repository } },
    merged_at: "2026-11-13T00:00:00Z", merge_commit_sha: git("rev-parse", "HEAD") };
  const scope = { full: "true", finbook: "true", mcp: "false" };
  writeFileSync(`${root}/event.json`, JSON.stringify({ action: "labeled", label: { name: "documentation" }, pull_request: pr }));
  environment(t, {
    GITHUB_EVENT_PATH: `${root}/event.json`, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: "999",
    GITHUB_STEP_SUMMARY: `${root}/summary`, VALIDATION_SCOPE: JSON.stringify(scope),
    REUSE_ENABLED: "true", REVIEWED_POLICY: policyIdentity(),
  });
  const built = release ? candidateFixture(t) : undefined;
  const state = {
    artifacts: (release ? ["release-candidate", "site-build"] : ["validation-evidence"])
      .map((name, i) => ({ id: i + 1, name, expired: false })),
    evidence: { format: "gik-samples-validation/1", fingerprint: fingerprint(), scope: selectedScope(scope), validated: true },
    logs: [], downloads: 0,
  };
  const services = {
    reuseRoot: `${root}/cache`, candidateDirectory: `${root}/promoted`, siteDirectory: `${root}/promoted-site`,
    log: (message) => state.logs.push(message),
    readApi(resource) {
      if (state.apiError) throw state.apiError;
      if (resource.includes("/artifacts?")) return { total_count: state.artifacts.length, artifacts: state.artifacts };
      if (resource.includes("/actions/workflows/ci.yml/runs?")) return { workflow_runs: [{
        id: 123, event: "pull_request", status: "completed", conclusion: "success",
        path: ".github/workflows/ci.yml", head_sha: pr.head.sha,
        repository: { full_name: repository }, head_repository: { full_name: repository }, pull_requests: [{ number: pr.number }],
      }] };
      if (resource.endsWith("/reviews?per_page=100")) return [{
        user: { id: 1, type: "User" }, author_association: "OWNER", state: "APPROVED", commit_id: pr.head.sha,
      }];
      if (resource.endsWith("/pulls")) return [pr];
      if (resource.includes("/commits/")) return {
        parents: [{ sha: "a".repeat(40) }, { sha: pr.head.sha }], commit: { tree: { sha: git("rev-parse", "HEAD^{tree}") } },
      };
      throw new Error(`Unexpected mocked API: ${resource}`);
    },
    download(_, __, name, directory) {
      state.downloads++;
      if (state.downloadError) throw state.downloadError;
      if (state.omitDownload) return;
      mkdirSync(directory, { recursive: true });
      if (name === "validation-evidence") {
        writeFileSync(`${directory}/validation.json`, state.rawEvidence || JSON.stringify(state.evidence));
      } else if (name === "release-candidate") {
        for (const file of ["candidate.json", "gik-components.tgz"]) {
          writeFileSync(`${directory}/${file}`, readFileSync(`${built.directory}/${file}`));
        }
      } else {
        cpSync(built.site, directory, { recursive: true });
        if (state.corruptSite) writeFileSync(`${directory}/assets/main.js`, "corrupted");
      }
    },
  };
  return { root, state, services, built };
}

test("site proof is deterministic, includes hidden/nested files and rejects added, removed or altered bytes", (t) => {
  const built = candidateFixture(t);
  const copy = `${fixture(t)}/site`;
  cpSync(built.site, copy, { recursive: true });
  assert.equal(siteDigest(copy), built.candidate.siteSha256);
  assert.doesNotThrow(() => verifyCandidate(built.directory, { siteDirectory: copy }));
  writeFileSync(`${copy}/.nojekyll`, "changed");
  assert.throws(() => verifySite(copy, built.candidate.siteSha256), /digest mismatch/);
  writeFileSync(`${copy}/.nojekyll`, "");
  writeFileSync(`${copy}/extra.js`, "extra");
  assert.throws(() => verifySite(copy, built.candidate.siteSha256), /digest mismatch/);
  rmSync(`${copy}/extra.js`);
  rmSync(`${copy}/assets/main.js`);
  assert.throws(() => verifySite(copy, built.candidate.siteSha256), /digest mismatch/);
});
test("absent or expired queried artifacts are explicit cache misses without attempting download", async (t) => {
  const { state, services } = reuseFixture(t);
  state.artifacts = [];
  assert.equal(await reuse("metadata", services), false);
  assert.equal(state.downloads, 0);
  assert.ok(state.logs.some((line) => line.includes("absent or expired")));
  state.artifacts = [{ id: 1, name: "validation-evidence", expired: true }];
  assert.equal(await reuse("metadata", services), false);
  assert.equal(state.downloads, 0);
});
test("valid evidence reuses; input/scope drift logs fallback rather than silently accepting different validation", async (t) => {
  const { state, services } = reuseFixture(t);
  assert.equal(await reuse("metadata", services), true);
  state.evidence.scope = selectedScope({ full: "false", finbook: "true", mcp: "false" });
  assert.equal(await reuse("metadata", services), false);
  assert.ok(state.logs.some((line) => line.includes("scope differs")));
  state.evidence.fingerprint = "0".repeat(64);
  assert.equal(await reuse("metadata", services), false);
  assert.ok(state.logs.some((line) => line.includes("input identity differs")));
});
test("API, download, missing advertised files and malformed/matching-incomplete proofs are hard failures", async (t) => {
  const { state, services } = reuseFixture(t);
  state.apiError = new Error("API unavailable");
  await assert.rejects(reuse("metadata", services), /API unavailable/);
  delete state.apiError;
  state.downloadError = new Error("download failed");
  await assert.rejects(reuse("metadata", services), /download failed/);
  delete state.downloadError;
  state.omitDownload = true;
  await assert.rejects(reuse("metadata", services), { code: "ENOENT" });
  delete state.omitDownload;
  state.rawEvidence = "{broken";
  await assert.rejects(reuse("metadata", services), SyntaxError);
  delete state.rawEvidence;
  state.evidence.validated = false;
  await assert.rejects(reuse("metadata", services), /incomplete/);
});
test("matching candidate corruption is fatal and promotion verifies both staged and restored site bytes", async (t) => {
  const { state, services, built } = reuseFixture(t, true);
  const path = `${built.directory}/gik-components.tgz`, original = readFileSync(path);
  writeFileSync(path, Buffer.concat([original, Buffer.from("corrupt")]));
  await assert.rejects(reuse("release", services), /tarball hash mismatch/);
  assert.equal(existsSync(services.siteDirectory), false);
  writeFileSync(path, original);
  state.corruptSite = true;
  await assert.rejects(reuse("release", services), /Site artifact digest mismatch/);
  assert.equal(existsSync(services.siteDirectory), false);
  state.corruptSite = false;
  // A new run would download into a fresh staging directory, just as Actions does.
  rmSync(`${services.reuseRoot}/reuse-123`, { recursive: true, force: true });
  assert.equal(await reuse("release", services), true);
  assert.equal(siteDigest(services.siteDirectory), built.candidate.siteSha256);
});
test("lock read errors preserve their cause and malformed JSON is not called a missing lock", (t) => {
  const root = fixture(t);
  assert.throws(() => checkLocks(root), (error) => /Missing reproducible lock/.test(error.message) && error.cause.code === "ENOENT");
  writeFileSync(`${root}/package-lock.json`, "{broken");
  assert.throws(() => checkLocks(root), (error) => /read or parse/.test(error.message) && error.cause instanceof SyntaxError);
});
test("preview reports only expected not-found/outside errors as 404 and logs unexpected IO errors as 500", () => {
  const logged = [], log = (...args) => logged.push(args);
  assert.equal(previewErrorStatus({ code: "ENOENT" }, log), 404);
  assert.equal(previewErrorStatus({ code: "OUTSIDE_SITE" }, log), 404);
  assert.equal(logged.length, 0);
  const denied = Object.assign(new Error("denied"), { code: "EACCES" });
  assert.equal(previewErrorStatus(denied, log), 500);
  assert.equal(logged[0][1], denied);
});

function branchFixture() {
  const repository = "nsreehari/gik-samples", bot = "gik-maintainer[bot]", base = "d".repeat(40), sha = "e".repeat(40);
  const branch = "automation/verified-gik-release";
  const ref = { ref: `refs/heads/${branch}`, object: { type: "commit", sha } };
  const head = { sha, author: { login: bot }, parents: [{ sha: base }], commit: {
    message: `chore: update verified GIK dependencies\n\nSource base: ${base}\nManifest SHA-256: ${"1".repeat(64)}\n`,
  } };
  const pull = { number: 7, state: "open", user: { login: bot },
    head: { ref: branch, sha, repo: { full_name: repository } }, base: { ref: "main", repo: { full_name: repository } } };
  const plan = { base, digest: "2".repeat(64), manifest: { tag: "v1.0.0", verificationRunId: "123", packages: [] },
    files: [{ path: "package-lock.json", content: '{"updated":true}' }] };
  const parameters = { plan, repository, bot, baseTree: "c".repeat(40) }, state = { writes: [], lookups: 0 };
  const services = {
    readApi(resource) {
      if (state.apiError) throw state.apiError;
      if (resource.includes("/git/matching-refs/")) {
        state.lookups++;
        if (state.absent) return [];
        return [
          { ref: `refs/heads/${branch}-human`, object: { type: "commit", sha: "a".repeat(40) } },
          state.advanced && state.lookups > 1 ? { ...ref, object: { ...ref.object, sha: "f".repeat(40) } } : ref,
        ];
      }
      if (resource.includes("/pulls?state=all")) return state.absent ? [] : [pull];
      if (resource.includes("/commits/")) return head;
      if (resource.endsWith("/git/ref/heads/main")) return { object: { sha: base } };
      throw new Error(`Unexpected branch API: ${resource}`);
    },
    writeApi(resource, body, method = "POST") {
      state.writes.push({ resource, body, method });
      return { sha: resource === "git/trees" ? "a".repeat(40) : "b".repeat(40) };
    },
  };
  const current = () => ({ ref, head, pulls: [pull], repository, bot, base, digest: plan.digest });
  return { parameters, services, state, current, head, pull, ref };
}
test("dependency proposals append fast-forward history, preserve current-main unrelated files, and never force refs", () => {
  const { parameters, services, state, current, ref } = branchFixture();
  assert.deepEqual(automationBranchState(current()).parents, [ref.object.sha, parameters.plan.base]);
  proposeDependencyUpdate(parameters, services);
  const tree = state.writes.find((write) => write.resource === "git/trees").body;
  assert.equal(tree.base_tree, parameters.baseTree);
  assert.deepEqual(tree.tree.map((entry) => entry.path), ["package-lock.json"]);
  const mainFiles = { "README.md": "unrelated human edit on main", "package-lock.json": "old" };
  const resultingFiles = { ...mainFiles, ...Object.fromEntries(tree.tree.map((entry) => [entry.path, entry.content])) };
  assert.equal(resultingFiles["README.md"], mainFiles["README.md"]);
  const commit = state.writes.find((write) => write.resource === "git/commits").body;
  assert.deepEqual(commit.parents, [ref.object.sha, parameters.plan.base]);
  assert.ok(commit.message.includes(`Source base: ${parameters.plan.base}`));
  const update = state.writes.find((write) => write.resource.startsWith("git/refs/"));
  assert.equal(update.method, "PATCH");
  assert.equal(update.body.force, false);
  assert.ok(!state.writes.some((write) => write.resource.includes("heads/main")));
});
test("human branch edits, missing automation markers and changed/closed PR identity require human action without writes", () => {
  for (const mutate of [
    ({ head }) => { head.author.login = "human"; },
    ({ head }) => { head.commit.message = "human changes"; },
    ({ head }) => { head.parents = [{ sha: "a".repeat(40) }]; },
    ({ pull }) => { pull.head.sha = "a".repeat(40); },
    ({ pull }) => { pull.head.repo.full_name = "human/fork"; },
    ({ pull }) => { pull.state = "closed"; },
    ({ pull }) => { pull.user.login = "human"; },
  ]) {
    const data = branchFixture();
    mutate(data);
    assert.throws(() => proposeDependencyUpdate(data.parameters, data.services), /requires human action/);
    assert.equal(data.state.writes.length, 0);
  }
});
test("same manifest is a no-op; API failures propagate and a racing branch update cannot be overwritten", () => {
  const same = branchFixture();
  same.parameters.plan.digest = "1".repeat(64);
  proposeDependencyUpdate(same.parameters, same.services);
  assert.equal(same.state.writes.length, 0);
  const offline = branchFixture();
  offline.state.apiError = new Error("matching refs unavailable");
  assert.throws(() => proposeDependencyUpdate(offline.parameters, offline.services), /matching refs unavailable/);
  assert.equal(offline.state.writes.length, 0);
  const raced = branchFixture();
  raced.state.advanced = true;
  assert.throws(() => proposeDependencyUpdate(raced.parameters, raced.services), /branch advanced/);
  assert.ok(!raced.state.writes.some((write) => write.resource.startsWith("git/refs")));
});
test("missing branches create only the automation ref; merged automation PRs retain history for the next proposal", () => {
  const initial = branchFixture();
  initial.state.absent = true;
  proposeDependencyUpdate(initial.parameters, initial.services);
  assert.deepEqual(initial.state.writes.find((write) => write.resource === "git/commits").body.parents, [initial.parameters.plan.base]);
  assert.equal(initial.state.writes.find((write) => write.resource === "git/refs").body.ref, "refs/heads/automation/verified-gik-release");
  const next = branchFixture();
  next.pull.state = "closed";
  next.pull.merged_at = "2026-11-13T00:00:00Z";
  proposeDependencyUpdate(next.parameters, next.services);
  assert.equal(next.state.writes.find((write) => write.resource === "pulls").body.base, "main");
  assert.equal(next.state.writes.find((write) => write.resource.startsWith("git/refs/")).body.force, false);
});
function provenance(commit, repository = "nsreehari/generative-interaction-kernel", path = ".github/workflows/publish.yml") {
  const predicateType = "https://slsa.dev/provenance/v1";
  return { attestations: [{ predicateType, bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify({
    predicateType, predicate: { buildDefinition: {
      externalParameters: { workflow: { repository: `https://github.com/${repository}`, path } },
      resolvedDependencies: [{ uri: `git+https://github.com/${repository}@refs/tags/v1.0.0`, digest: { gitCommit: commit } }],
    } },
  })).toString("base64") } } }] };
}
test("publication rejects mismatched dispatch provenance before immutable upload", () => {
  const source = "a".repeat(40);
  assert.doesNotThrow(() => assertPublicationSource(source, source));
  assert.throws(() => assertPublicationSource(source, "b".repeat(40)), /exact candidate source SHA/);
  assert.throws(() => assertPublicationSource(source, undefined), /immutable release tag/);
});
test("providers provenance needs its explicit publishing workflow without weakening existing verification", () => {
  const commit = "a".repeat(40), repository = "nsreehari/gik-samples";
  const workflow = ".github/workflows/release-service-providers.yml";
  const attestation = provenance(commit, repository, workflow);
  assert.throws(() => assertProvenance(attestation, repository, commit), /expected repository/);
  assert.doesNotThrow(() => assertProvenance(attestation, repository, commit, workflow));
  assert.throws(() => assertProvenance(provenance(commit, repository), repository, commit, workflow), /expected repository/);
  assert.throws(() => assertProvenance(attestation, repository, commit, ".github/workflows/untrusted.yml"), /Unsupported/);
});
test("verified unchanged GIK package provenance may come from an older ancestor, with cached source comparisons", () => {
  const old = "a".repeat(40), release = "b".repeat(40), comparisons = new Map();
  let calls = 0;
  const readApi = (resource) => {
    calls++;
    assert.ok(resource.endsWith(`/compare/${old}...${release}`));
    return { status: "ahead", merge_base_commit: { sha: old } };
  };
  assert.equal(provenanceSourceCommit(provenance(old), "nsreehari/generative-interaction-kernel"), old);
  assert.equal(assertReleasedProvenance(provenance(old), release, readApi, comparisons), old);
  assert.equal(assertReleasedProvenance(provenance(old), release, readApi, comparisons), old);
  assert.equal(calls, 1);
  assert.equal(assertReleasedProvenance(provenance(release), release, readApi, comparisons), release);
  assert.equal(calls, 1);
  assert.throws(() => assertProvenance(provenance(old), "nsreehari/generative-interaction-kernel", release), /newly published candidate/);
});
test("unrelated provenance commits, repository/workflow mismatch and source API failures fail closed", () => {
  const old = "a".repeat(40), release = "b".repeat(40);
  assert.throws(() => assertReleasedProvenance(provenance(old), release,
    () => ({ status: "diverged", merge_base_commit: { sha: "c".repeat(40) } })), /not an ancestor/);
  assert.throws(() => assertReleasedProvenance(provenance(old), release,
    () => { throw new Error("source compare offline"); }), /source compare offline/);
  for (const attestation of [
    provenance(old, "attacker/repo"), provenance(old, undefined, ".github/workflows/untrusted.yml"), provenance("main"),
  ]) assert.throws(() => assertReleasedProvenance(attestation, release), /expected repository/);
});
test("Pages binds the source-built site before collecting archives; metadata cannot cancel mandatory source CI", () => {
  const release = readFileSync(new URL("../../.github/workflows/publish.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(release, /npm run build -- --site-only/);
  assert.match(release, /EXPECTED_SITE_SHA256: \$\{\{ needs\.site\.outputs\.sha256 \}\}/);
  assert.match(release, /siteDigest\("src\/browser-host\/dist"\)/);
  assert.match(release, /verifySite\("src\/browser-host\/dist", process\.env\.EXPECTED_SITE_SHA256\)/);
  assert.ok(release.indexOf('siteDigest("src/browser-host/dist")') < release.indexOf("name: site-build"));
  assert.ok(release.indexOf('verifySite("src/browser-host/dist"') < release.indexOf("run: node scripts/collect-pages-packages.mjs"));
  const lanes = readFileSync(new URL("../../.github/workflows/validation-lane.yml", import.meta.url), "utf8");
  assert.ok(lanes.indexOf("node scripts/actions-evidence.mjs verify-site") < lanes.indexOf("- name: Upload site"));
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /cancel-in-progress: \$\{\{ github\.event\.action != 'labeled' && github\.event\.action != 'unlabeled' && github\.event\.action != 'edited' \}\}/);
});
