import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { assertProvenance, fetchProvenance } from "./npm-provenance.mjs";

const candidate = JSON.parse(readFileSync(".artifacts/candidate/candidate.json", "utf8"));
const version = process.env.COMPONENTS_VERSION;
if (candidate.version !== version) throw new Error("Consumer version differs from candidate");
let metadata;
for (let attempt = 0; attempt < 12; attempt++) {
  const response = await fetch(`https://registry.npmjs.org/gik-components/${version}`, { redirect: "error" });
  if (response.ok) {
    metadata = await response.json();
    if (metadata.dist?.attestations) break;
  } else if (response.status !== 404) throw new Error(`Registry HTTP ${response.status}`);
  await delay(10_000);
}
if (metadata?.name !== "gik-components" || metadata.version !== version
  || metadata.dist.integrity !== candidate.integrity || !metadata.dist.attestations?.provenance) {
  throw new Error("Registry identity, integrity or provenance is missing/mismatched");
}
const url = new URL(metadata.dist.tarball);
if (url.origin !== "https://registry.npmjs.org" || url.username || url.password) throw new Error("Unexpected tarball host");
const response = await fetch(url, { redirect: "error" });
if (!response.ok) throw new Error("Cannot fetch registry archive");
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash("sha256").update(bytes).digest("hex") !== candidate.sha256) throw new Error("Registry archive differs from validated bytes");
const directory = ".artifacts/registry-consumer";
mkdirSync(directory, { recursive: true });
writeFileSync(`${directory}/package.json`, JSON.stringify({
  private: true, type: "module", dependencies: { "gik-components": version },
}));
const npm = (...args) => execFileSync("npm", ["exec", "--yes", "--package=npm@11.19.0", "--", "npm", ...args],
  { cwd: directory, stdio: "inherit", shell: process.platform === "win32" });
npm("install", "--ignore-scripts", "--no-audit", "--no-fund");
npm("audit", "signatures");
assertProvenance(await fetchProvenance(metadata.dist), "nsreehari/gik-samples", candidate.commit);
const pkg = JSON.parse(readFileSync(`${directory}/node_modules/gik-components/package.json`, "utf8"));
for (const name of Object.keys(pkg.exports)) {
  const specifier = name === "." ? "gik-components" : `gik-components/${name.slice(2)}`;
  execFileSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(specifier)})`],
    { cwd: directory, stdio: "inherit" });
}
console.log(`Verified clean npm consumer, signatures/provenance, exports and exact archive: gik-components@${version}`);
