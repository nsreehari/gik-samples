import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { classifyChanges, isManualPrerelease, needsComponentsRelease, nextComponentsVersion, providerPublicationMode, providersVersion } from "../workflow-policy.mjs";

test("documentation avoids installs, while runtime, shared policy and unknown inputs fail closed", () => {
  assert.deepEqual(classifyChanges(["README.md", "docs/samples.md"]), {
    full: false, finbook: false, mcp: false, pages: false,
  });
  assert.deepEqual(classifyChanges(["packages/mcp-server/src/index.js"]), {
    full: false, finbook: false, mcp: true, pages: false,
  });
  assert.deepEqual(classifyChanges(["apps/finbook/blueprints/finbook/blueprint.json"]), {
    full: false, finbook: true, mcp: false, pages: false,
  });
  for (const file of ["package.json", "scripts/build.mjs", ".github/workflows/ci.yml", "new-build.config"]) {
    assert.deepEqual(classifyChanges([file]), { full: true, finbook: true, mcp: true, pages: true });
  }
  assert.equal(classifyChanges(["src/browser-host/public/docs/index.html"]).pages, true);
});

test("patch is automatic; minor and major intent is explicit and conflicting or prerelease intent fails", () => {
  assert.equal(nextComponentsVersion("0.3.0", []), "0.3.1");
  assert.equal(nextComponentsVersion("0.3.8", ["release:minor"]), "0.4.0");
  assert.equal(nextComponentsVersion("1.3.8", ["release:major"]), "2.0.0");
  assert.throws(() => nextComponentsVersion("1.0.0-next.1", []), /stable/);
  assert.throws(() => nextComponentsVersion("1.0.0", ["release:major", "release:minor"]), /only one/);
  assert.throws(() => isManualPrerelease("1.0.0", "1.1.0-next.0", []), /release:prerelease/);
  assert.equal(isManualPrerelease("1.0.0", "1.1.0-next.0", ["release:prerelease"]), true);
  assert.equal(isManualPrerelease("1.1.0-next.0", "1.1.0", ["release:prerelease"]), true);
  assert.throws(() => isManualPrerelease("1.0.0", "1.1.0-next.0", [
    "release:prerelease", "release:minor",
  ]), /cannot be combined/);
});

test("published files and dependency changes release; tests, unrelated apps and bot-only versions do not", () => {
  const base = { name: "gik-components", version: "0.3.0", dependencies: { "gik-kernel": ">=0.4.1" } };
  const versioned = { ...base, version: "0.3.1" };
  assert.equal(needsComponentsRelease(["packages/components/src/shared/index.ts"], base, base), true);
  assert.equal(needsComponentsRelease(["packages/components/README.md"], base, base), true);
  assert.equal(needsComponentsRelease(["packages/components/test/chart.test.ts"], base, base), false);
  assert.equal(needsComponentsRelease(["apps/finbook/package.json"], base, base), false);
  assert.equal(needsComponentsRelease(["packages/components/package.json"], base, versioned), false);
  assert.equal(needsComponentsRelease(["packages/components/package.json"], base, {
    ...base, dependencies: { "gik-kernel": ">=0.5.0" },
  }), true);
});

test("providers have a guarded first version, independent future bumps and no aggregate exports", () => {
  const manifest = { name: "gik-service-providers", version: "0.1.0", exports: { "./gmail": "./dist/gmail.js", "./scheduler": "./dist/scheduler.js" } };
  assert.equal(providersVersion([], null, manifest, []), "0.1.0");
  assert.throws(() => providersVersion([], null, { ...manifest, version: "1.0.0" }, []), /First/);
  assert.throws(() => providersVersion([], null, { ...manifest, exports: { ...manifest.exports, ".": "./dist/index.js" } }, []), /individual/);
  assert.equal(providersVersion(["packages/service-providers/src/gmail.ts"], manifest, manifest, []), "0.1.1");
  assert.equal(providersVersion(["packages/service-providers/src/gmail.ts"], manifest, manifest, ["release:minor"]), "0.2.0");
  assert.equal(providersVersion(["packages/service-providers/test/providers.test.ts"], manifest, manifest, []), null);
  assert.equal(providersVersion(["packages/components/src/index.ts"], manifest, manifest, []), null);
  assert.equal(providersVersion(["packages/service-providers/package.json"], manifest, { ...manifest, version: "0.1.1" }, []), null);
});

test("first publication releases the ordinary concurrency slot and requires explicit protected bootstrap", () => {
  assert.equal(providerPublicationMode(false, false), "bootstrap-required");
  assert.equal(providerPublicationMode(true, false), "publish");
  assert.throws(() => providerPublicationMode(false, true, ""), /explicit/);
  assert.equal(providerPublicationMode(false, true, "PUBLISH gik-service-providers"), "bootstrap");
  const workflow = readFileSync(new URL("../../.github/workflows/release-service-providers.yml", import.meta.url), "utf8");
  assert.match(workflow, /ready: \$\{\{ steps\.publication\.outputs\.ready \}\}/);
  assert.match(workflow, /publish:\s+needs: validate\s+if: needs\.validate\.outputs\.ready == 'true'/);
});

test("PR classification validates manifest-only catch-up versions in a detached checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "components-version-policy-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  const manifest = join(root, "packages", "components", "package.json");
  const writeVersion = (version) => writeFileSync(manifest, JSON.stringify({ name: "gik-components", version }));
  try {
    git("init", "--initial-branch=fixture");
    git("config", "user.name", "Release fixture");
    git("config", "user.email", "fixture@example.invalid");
    mkdirSync(join(root, "packages", "components"), { recursive: true });
    writeVersion("0.3.0");
    git("add", "packages");
    git("commit", "-m", "baseline");
    const base = git("rev-parse", "HEAD");
    for (const [version, labels, expectedError] of [
      ["0.4.0", [], null],
      ["0.2.9", [], /version must increase/],
      ["invalid", [], /stable semantic versions/],
      ["0.04.0", [], /stable semantic versions/],
      ["0.4.0-next.0", [], /release:prerelease/],
      ["0.4.0-next.0", ["release:prerelease"], null],
    ]) {
      git("checkout", "--detach", base);
      writeVersion(version);
      git("add", "packages");
      git("commit", "-m", `version ${version}`);
      const eventPath = join(root, "event.json");
      writeFileSync(eventPath, JSON.stringify({ pull_request: {
        base: { sha: base }, head: { sha: git("rev-parse", "HEAD") },
        labels: labels.map((name) => ({ name })),
      } }));
      const result = spawnSync(process.execPath, [
        fileURLToPath(new URL("../workflow-policy.mjs", import.meta.url)),
      ], {
        cwd: root, encoding: "utf8",
        env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: join(root, "output") },
      });
      assert.ifError(result.error);
      if (expectedError) {
        assert.notEqual(result.status, 0, version);
        assert.match(result.stderr, expectedError);
      } else {
        assert.equal(result.status, 0, result.stderr);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
