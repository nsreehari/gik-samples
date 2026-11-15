import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { api } from "./actions-evidence.mjs";
import { assertProvenance, fetchProvenance } from "./npm-provenance.mjs";
import { assertReleasedProvenance, verifiedSource, waitForVerificationRun } from "./verified-gik-update.mjs";

const core = "nsreehari/generative-interaction-kernel";
const libraries = new Map([
  ["nsreehari/gik-components", "gik-components"],
  ["nsreehari/gik-service-providers", "gik-service-providers"],
]);

export function assertLibraryRun(run, payload, jobs) {
  assert.ok(libraries.has(payload.repository), "Unapproved publication repository");
  assert.equal(run.repository?.full_name, payload.repository);
  assert.equal(run.head_repository?.full_name, payload.repository);
  assert.equal(run.path, ".github/workflows/publish.yml");
  assert.equal(run.event, "release");
  assert.equal(run.head_sha, payload.commit);
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  assert.ok(jobs.some(({ name, conclusion }) => name === "Verify published package" && conclusion === "success"),
    "Missing successful registry verification job");
}

export async function libraryPublication(payload, { readApi = api, wait = waitForVerificationRun } = {}) {
  assert.ok(libraries.has(payload.repository), "Unapproved publication repository");
  assert.match(payload.commit ?? "", /^[a-f0-9]{40}$/);
  assert.match(payload.runId ?? "", /^[1-9]\d*$/);
  assert.match(payload.tag ?? "", /^npm-\d{4}-\d{2}-\d{2}\.[1-9]\d*$/);
  const prefix = `repos/${payload.repository}`;
  const release = readApi(`${prefix}/releases/tags/${payload.tag}`);
  assert.ok(!release.draft && !release.prerelease && release.tag_name === payload.tag, "Not a stable library release");
  let tag = readApi(`${prefix}/git/ref/tags/${payload.tag}`).object;
  for (let depth = 0; tag.type === "tag" && depth < 5; depth++) tag = readApi(`${prefix}/git/tags/${tag.sha}`).object;
  assert.ok(tag.type === "commit" && tag.sha === payload.commit, "Library release tag changed");
  const run = await wait({}, () => readApi(`${prefix}/actions/runs/${payload.runId}`));
  const jobResponse = readApi(`${prefix}/actions/runs/${payload.runId}/attempts/${run.run_attempt}/jobs?per_page=100`);
  assert.ok(jobResponse.total_count <= 100, "Ambiguous publication job inventory");
  assertLibraryRun(run, payload, jobResponse.jobs);
  const blob = readApi(`${prefix}/contents/package.json?ref=${payload.commit}`);
  assert.equal(blob.encoding, "base64");
  const pkg = JSON.parse(Buffer.from(blob.content, "base64").toString("utf8"));
  assert.equal(pkg.name, libraries.get(payload.repository));
  assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  return { repository: payload.repository, commit: payload.commit, packages: [{ name: pkg.name, version: pkg.version }] };
}

export async function verifyPagesPublication(event, {
  verifyCore = verifiedSource, verifyLibrary = libraryPublication,
  fetcher = fetch, provenance = fetchProvenance, readApi = api,
  run = (args) => execFileSync("npm", ["exec", "--yes", "--package=npm@11.19.0", "--", "npm", ...args], { stdio: "inherit" }),
} = {}) {
  assert.ok(["gik-release-verified", "gik-library-release-verified"].includes(event.action), "Unsupported publication signal");
  const source = event.action === "gik-release-verified"
    ? (await verifyCore(event.client_payload ?? {})).manifest
    : await verifyLibrary(event.client_payload ?? {});
  const directory = ".artifacts/publication-consumer";
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/package.json`, '{"private":true,"dependencies":{}}\n');
  for (const pkg of source.packages) {
    const response = await fetcher(`https://registry.npmjs.org/${pkg.name}/${pkg.version}`,
      { redirect: "error", signal: AbortSignal.timeout(60_000) });
    assert.ok(response.ok, `Publication metadata HTTP ${response.status}`);
    const metadata = await response.json();
    assert.equal(metadata.name, pkg.name);
    assert.equal(metadata.version, pkg.version);
    assert.match(metadata.dist?.integrity ?? "", /^sha512-[A-Za-z0-9+/]{86}==$/);
    assert.equal(metadata.dist.tarball, `https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz`);
    if (pkg.integrity) assert.equal(metadata.dist.integrity, pkg.integrity);
    if (pkg.tarball) assert.equal(metadata.dist.tarball, pkg.tarball);
    assert.ok(metadata.dist.attestations?.provenance, "Publication is missing npm provenance");
    const attestation = await provenance(metadata.dist);
    if (source.repository === core) assertReleasedProvenance(attestation, source.commit, readApi);
    else assertProvenance(attestation, source.repository, source.commit);
  }
  run(["install", "--prefix", directory, "--ignore-scripts", "--no-audit", "--no-fund",
    ...source.packages.map(({ name, version }) => `${name}@${version}`)]);
  run(["audit", "signatures", "--prefix", directory]);
  console.log(`Verified publication signal from ${source.repository}@${source.commit}`);
  return source;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  await verifyPagesPublication(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")));
}
