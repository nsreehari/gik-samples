import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function validateLatestLock(lock, metadata) {
  for (const pkg of metadata) {
    const entry = lock.packages?.[`node_modules/${pkg.name}`];
    assert.ok(entry && !entry.link, `Missing npm resolution: ${pkg.name}`);
    assert.equal(entry.version, pkg.version, `Latest version changed or was not resolved: ${pkg.name}`);
    assert.equal(entry.integrity, pkg.dist.integrity, `Latest integrity differs: ${pkg.name}`);
    assert.equal(entry.resolved, pkg.dist.tarball, `Latest tarball differs: ${pkg.name}`);
  }
}

export async function resolveLatestGik({
  root = ".", fetcher = fetch,
  run = (args) => execFileSync("npm", ["exec", "--yes", "--package=npm@11.19.0", "--", "npm", ...args],
    { cwd: root, stdio: "inherit" }),
} = {}) {
  const manifestPath = join(root, "package.json");
  const before = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(before);
  const names = Object.entries(manifest.dependencies ?? {}).filter(([name]) => name.startsWith("gik-")).map(([name, range]) => {
    assert.equal(range, "latest", `Fresh Pages resolution requires latest: ${name}`);
    return name;
  });
  assert.ok(names.length, "No GIK npm consumers declared");
  const metadata = await Promise.all(names.map(async (name) => {
    const response = await fetcher(`https://registry.npmjs.org/${name}/latest`,
      { redirect: "error", signal: AbortSignal.timeout(60_000) });
    assert.ok(response.ok, `Latest metadata HTTP ${response.status}: ${name}`);
    const pkg = await response.json();
    assert.equal(pkg.name, name);
    assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    assert.match(pkg.dist?.integrity ?? "", /^sha512-[A-Za-z0-9+/]{86}==$/);
    assert.equal(pkg.dist.tarball, `https://registry.npmjs.org/${name}/-/${name}-${pkg.version}.tgz`);
    return pkg;
  }));
  run(["update", ...names, "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);
  assert.equal(readFileSync(manifestPath, "utf8"), before, "Resolution changed dependency declarations");
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  validateLatestLock(lock, metadata);
  const receipt = {
    format: "gik-samples-resolution/1",
    packages: metadata.map(({ name, version, dist }) => ({ name, version, integrity: dist.integrity })),
  };
  mkdirSync(join(root, ".artifacts"), { recursive: true });
  writeFileSync(join(root, ".artifacts/latest-gik.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.env.GITHUB_ACTIONS, "true", "Latest resolution runs only in CI");
  await resolveLatestGik();
}
