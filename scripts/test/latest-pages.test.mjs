import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveLatestGik, validateLatestLock } from "../resolve-latest-gik.mjs";
import { assertLibraryRun, libraryPublication, verifyPagesPublication } from "../verify-pages-publication.mjs";
import { planRelease, releaseInputsAt } from "../plan-release.mjs";
import { coreVersions } from "../collect-pages-packages.mjs";

const pkg = {
  name: "gik-components", version: "0.3.3",
  dist: { integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
    tarball: "https://registry.npmjs.org/gik-components/-/gik-components-0.3.3.tgz" },
};
const entry = { version: pkg.version, resolved: pkg.dist.tarball, integrity: pkg.dist.integrity };

test("fresh resolution updates only declared GIK packages and rejects stale, linked, or altered bytes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "latest-pages-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = { dependencies: { "gik-components": "latest", react: "^18.3.1" }, overrides: { "gik-components": "$gik-components" } };
  writeFileSync(join(root, "package.json"), JSON.stringify(source));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages: { "node_modules/gik-components": { ...entry, version: "0.3.2" } } }));
  const commands = [];
  const receipt = await resolveLatestGik({
    root, fetcher: async (url) => {
      assert.equal(url, "https://registry.npmjs.org/gik-components/latest");
      return { ok: true, json: async () => pkg };
    },
    run: (args) => {
      commands.push(args);
      writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages: { "node_modules/gik-components": entry } }));
    },
  });
  assert.deepEqual(commands, [["update", "gik-components", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]]);
  assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")), source);
  assert.equal(receipt.packages[0].version, "0.3.3");
  for (const patch of [{ version: "0.3.2" }, { link: true }, { integrity: "sha512-other" }, { resolved: "file:../components" }]) {
    assert.throws(() => validateLatestLock({ packages: { "node_modules/gik-components": { ...entry, ...patch } } }, [pkg]));
  }
  await assert.rejects(resolveLatestGik({ root, fetcher: async () => ({ ok: false, status: 503 }), run: () => assert.fail("Must not resolve after metadata failure") }), /503/);
});

function publicationFixture() {
  const payload = { repository: "nsreehari/gik-components", commit: "a".repeat(40), runId: "123", tag: "npm-2026-11-15.1" };
  const run = { repository: { full_name: payload.repository }, head_repository: { full_name: payload.repository },
    path: ".github/workflows/publish.yml", event: "release", head_sha: payload.commit, run_attempt: 1,
    status: "completed", conclusion: "success" };
  const jobs = [{ name: "Verify published package", conclusion: "success" }];
  return { payload, run, jobs };
}

test("library signal requires official stable tag, source, workflow and successful verification", async () => {
  const { payload, run, jobs } = publicationFixture();
  assert.doesNotThrow(() => assertLibraryRun(run, payload, jobs));
  for (const patch of [{ event: "workflow_dispatch" }, { conclusion: "failure" }, { status: "in_progress" },
    { path: ".github/workflows/ci.yml" }, { head_sha: "b".repeat(40) }, { head_repository: { full_name: "attacker/fork" } }]) {
    assert.throws(() => assertLibraryRun({ ...run, ...patch }, payload, jobs));
  }
  assert.throws(() => assertLibraryRun(run, payload, [{ name: "Verify published package", conclusion: "skipped" }]));
  const readApi = (resource) => {
    if (resource.includes("/releases/tags/")) return { tag_name: payload.tag, draft: false, prerelease: false };
    if (resource.includes("/git/ref/")) return { object: { type: "commit", sha: payload.commit } };
    if (resource.endsWith("/actions/runs/123")) return run;
    if (resource.includes("/jobs?")) return { total_count: 1, jobs };
    if (resource.includes("/contents/")) return { encoding: "base64", content: Buffer.from(JSON.stringify(pkg)).toString("base64") };
    throw new Error(resource);
  };
  assert.equal((await libraryPublication(payload, { readApi })).packages[0].version, pkg.version);
  await assert.rejects(libraryPublication({ ...payload, repository: "attacker/fork" }, { readApi }), /Unapproved/);
  await assert.rejects(libraryPublication({ ...payload, tag: "npm-next-2026-11-15.1" }, { readApi }));
});

test("publication verification checks registry provenance and signatures, never treating dispatch claims as proof", async (t) => {
  const directory = ".artifacts/publication-consumer";
  mkdirSync(".artifacts", { recursive: true });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { payload } = publicationFixture();
  const predicateType = "https://slsa.dev/provenance/v1";
  const attestation = { attestations: [{ predicateType, bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify({
    predicateType, predicate: { buildDefinition: {
      externalParameters: { workflow: { repository: `https://github.com/${payload.repository}`, path: ".github/workflows/publish.yml" } },
      resolvedDependencies: [{ uri: `git+https://github.com/${payload.repository}`, digest: { gitCommit: payload.commit } }],
    } },
  })).toString("base64") } } }] };
  const commands = [];
  const services = {
    verifyLibrary: async () => ({ ...payload, packages: [{ name: pkg.name, version: pkg.version }] }),
    fetcher: async () => ({ ok: true, json: async () => ({ ...pkg, dist: { ...pkg.dist, attestations: { provenance: {} } } }) }),
    provenance: async () => attestation, run: (args) => commands.push(args),
  };
  await verifyPagesPublication({ action: "gik-library-release-verified", client_payload: payload }, services);
  assert.deepEqual(commands[1], ["audit", "signatures", "--prefix", directory]);
  await assert.rejects(verifyPagesPublication({ action: "untrusted" }, services), /Unsupported/);
  await assert.rejects(verifyPagesPublication({ action: "gik-library-release-verified", client_payload: payload },
    { ...services, provenance: async () => ({ attestations: [] }) }), /provenance/);
});

test("normal refresh uses trusted main and latest locks, while explicit rollback retains immutable source checks", () => {
  const sha = "a".repeat(40);
  const root = { version: "0.0.0", dependencies: { "gik-components": "latest", "gik-service-providers": "latest" } };
  const lock = { lockfileVersion: 3, packages: { "": root,
    "node_modules/gik-components": { version: "0.3.3" }, "node_modules/gik-service-providers": { version: "0.3.0" } } };
  const refs = [];
  const runGit = (command, ref) => {
    if (command === "rev-parse") { refs.push(ref); return sha; }
    if (command === "merge-base") return "";
    const path = ref.slice(ref.indexOf(":") + 1);
    return JSON.stringify(path === "package.json" ? root : path === "package-lock.json" ? lock : coreVersions);
  };
  assert.equal(planRelease({ kind: "repository_dispatch", event: { client_payload: { commit: "untrusted" } } }, runGit).commit, sha);
  assert.ok(refs.includes("origin/main^{commit}"));
  assert.equal(planRelease({ kind: "workflow_dispatch", event: {} }, runGit).publish, false);
  assert.deepEqual(releaseInputsAt(sha, runGit), coreVersions);
  assert.throws(() => planRelease({ kind: "workflow_dispatch", event: {}, releaseRef: "main" }, runGit), /pinned/);
});
