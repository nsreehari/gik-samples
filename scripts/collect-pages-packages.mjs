import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const coreVersions = JSON.parse(await readFile(new URL("./pages-core-versions.json", import.meta.url), "utf8"));
export function validateCoreVersions(versions, allowLatest = false) {
  if (!versions || typeof versions !== "object" || Array.isArray(versions)
    || Object.keys(versions).filter((name) => !allowLatest || name !== "gik-service-providers").sort().join("\n")
      !== Object.keys(coreVersions).sort().join("\n")
    || Object.values(versions).some((version) => !(allowLatest && version === "latest")
      && (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)))) {
    throw new Error("Pages requires the complete exact core package version set");
  }
  return versions;
}

async function fetchPublished(url, fetcher, pause) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(60_000), redirect: "error" });
    if (response.ok) return response;
    if (response.status !== 404 || attempt === 5) {
      throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
    }
    console.warn(`Published artifact not visible yet: ${url}; retrying in 10 seconds`);
    await pause(10_000);
  }
}

export async function collectPagesPackages({
  componentsVersion = "latest",
  versions = Object.fromEntries([...Object.keys(coreVersions), "gik-service-providers"].map((name) => [name, "latest"])),
  outputDirectory,
  fetcher = fetch,
  pause = delay,
}) {
  const isVersion = (value) => typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
  if (componentsVersion !== "latest" && !isVersion(componentsVersion)) {
    throw new Error("A valid Components release version is required");
  }
  const packages = [];
  const downloads = [];
  validateCoreVersions(versions, true);
  for (const [name, requestedVersion] of Object.entries({ ...versions, "gik-components": componentsVersion })) {
    const metadataUrl = `https://registry.npmjs.org/${name}/${requestedVersion}`;
    const metadata = await (await fetchPublished(metadataUrl, fetcher, pause)).json();
    if (metadata.name !== name || !isVersion(metadata.version)
      || (requestedVersion !== "latest" && metadata.version !== requestedVersion)) {
      throw new Error(`Registry metadata does not match ${name}@${requestedVersion}`);
    }
    const version = metadata.version;
    const tarball = new URL(metadata.dist.tarball);
    if (tarball.protocol !== "https:" || tarball.hostname !== "registry.npmjs.org"
      || tarball.port || tarball.username || tarball.password) {
      throw new Error(`Unexpected npm tarball URL for ${name}@${version}`);
    }
    const bytes = Buffer.from(await (await fetchPublished(tarball.href, fetcher, pause)).arrayBuffer());
    const integrity = metadata.dist.integrity;
    if (typeof integrity !== "string" || !integrity.split(/\s+/).some((entry) => {
      const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/.exec(entry);
      if (!match) return false;
      const expected = Buffer.from(match[2], "base64");
      const actual = createHash(match[1]).update(bytes).digest();
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    })) {
      throw new Error(`Integrity verification failed for ${name}@${version}`);
    }
    const file = `${name}-${version}.tgz`;
    downloads.push({ file, bytes });
    packages.push({
      name, version, file, bytes: bytes.length, integrity,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      npmUrl: `https://www.npmjs.com/package/${name}/v/${version}`,
      tarballUrl: tarball.href,
    });
  }
  await mkdir(outputDirectory, { recursive: true });
  for (const { file, bytes } of downloads) await writeFile(join(outputDirectory, file), bytes);
  const manifest = { format: "gik-pages-packages/1", packages };
  await writeFile(join(outputDirectory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(join(outputDirectory, "SHA256SUMS"),
    packages.map(({ sha256, file }) => `${sha256}  ${file}\n`).join(""));
  await writeFile(join(outputDirectory, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>GIK package downloads</title><link rel="stylesheet" href="../docs/site.css"></head><body>
<header><nav aria-label="GIK resources"><a href="../">GIK Studio</a>
<a href="../docs/">Documentation</a><a href="../getting-started/">Build a sample app</a>
<a href="../storybook/">Components Storybook</a></nav></header><main>
<h1>GIK package downloads</h1>
<p>Released npm archives, verified against npm integrity metadata. These downloads are not an npm registry.</p>
<p><a href="manifest.json">Package manifest and npm sources</a> | <a href="SHA256SUMS">SHA-256 checksums</a></p>
<ul>${packages.map(({ name, version, file }) =>
    `<li><a href="${file}">${name}@${version}</a></li>`).join("\n")}</ul>
</main></body></html>
`);
  console.log(`Collected and integrity-verified ${packages.length} published packages into ${outputDirectory}`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await collectPagesPackages({
    outputDirectory: fileURLToPath(new URL("../src/browser-host/dist/vendor/", import.meta.url)),
  });
}
