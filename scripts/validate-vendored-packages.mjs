import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const vendorRoot = join(repositoryRoot, "vendor", "gik-packages");
const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(vendorRoot, "manifest.json"), "utf8"));

if (manifest.format !== "gik-vendored-packages/1") {
  throw new Error(`Unsupported vendored package manifest '${manifest.format}'.`);
}
if (!/^[0-9a-f]{40}$/.test(manifest.sourceCommit)) {
  throw new Error("Vendored package manifest requires a full source commit.");
}

const manifestNames = new Set();
for (const artifact of manifest.packages) {
  if (manifestNames.has(artifact.name)) {
    throw new Error(`Duplicate vendored package '${artifact.name}'.`);
  }
  manifestNames.add(artifact.name);
  const dependency = packageJson.dependencies[artifact.name];
  const expectedDependency = `file:vendor/gik-packages/${artifact.file}`;
  if (dependency !== expectedDependency) {
    throw new Error(`${artifact.name} must resolve to '${expectedDependency}'.`);
  }

  const archive = join(vendorRoot, artifact.file);
  const content = await readFile(archive);
  const hash = createHash("sha256").update(content).digest("hex");
  if (content.byteLength !== artifact.bytes || hash !== artifact.sha256) {
    throw new Error(`Vendored package '${artifact.name}' does not match its manifest.`);
  }

  const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
  if (listing.status !== 0) {
    throw new Error(`Unable to inspect vendored package '${artifact.name}'.`);
  }
  if (listing.stdout.split(/\r?\n/).some((path) => path.endsWith(".map"))) {
    throw new Error(`Vendored package '${artifact.name}' contains source maps.`);
  }
}

const localGikDependencies = Object.entries(packageJson.dependencies)
  .filter(([name, value]) => name.startsWith("@gik/") && String(value).startsWith("file:"));
for (const [name] of localGikDependencies) {
  if (!manifestNames.has(name)) throw new Error(`Local GIK dependency '${name}' is missing from the manifest.`);
}
if (localGikDependencies.length !== manifest.packages.length) {
  throw new Error("Vendored package manifest and root dependencies are inconsistent.");
}

console.log(`Validated ${manifest.packages.length} vendored GIK packages from ${manifest.sourceCommit}.`);
