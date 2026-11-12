import assert from "node:assert/strict";
import test from "node:test";
import { classifyChanges, isManualPrerelease, needsComponentsRelease, nextComponentsVersion } from "../workflow-policy.mjs";

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
