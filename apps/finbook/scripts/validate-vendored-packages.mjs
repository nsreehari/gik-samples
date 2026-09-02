import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "..");
const vendorRoot = join(appRoot, "vendor", "gik-packages");
const packageJson = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(vendorRoot, "manifest.json"), "utf8"));

if (manifest.format !== "finbook-vendored-gik-packages/1") {
  throw new Error(`Unsupported Finbook vendor manifest '${manifest.format}'.`);
}

for (const artifact of manifest.packages) {
  const expected = `file:vendor/gik-packages/${artifact.file}`;
  if (packageJson.dependencies?.[artifact.name] !== expected) {
    throw new Error(`${artifact.name} must resolve to '${expected}'.`);
  }
  const content = await readFile(join(vendorRoot, artifact.file));
  const hash = createHash("sha256").update(content).digest("hex");
  if (content.byteLength !== artifact.bytes || hash !== artifact.sha256) {
    throw new Error(`Vendored package '${artifact.name}' does not match its manifest.`);
  }
}

const localDependencies = Object.entries(packageJson.dependencies ?? {})
  .filter(([name]) => name.startsWith("gik-"));
if (localDependencies.length !== manifest.packages.length) {
  throw new Error("Finbook GIK dependencies and vendor manifest are inconsistent.");
}

console.log(`Validated ${manifest.packages.length} Finbook GIK packages.`);
