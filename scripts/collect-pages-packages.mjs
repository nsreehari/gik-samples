import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const coreVersions = {
  "gik-agent-lifecycle-exp": "0.3.0",
  "gik-blueprint-agent-host": "0.2.1",
  "gik-kernel": "0.4.1",
  "gik-evaluators": "0.4.0",
  "gik-durable-runtime": "0.9.0",
  "gik-blueprint": "0.5.0",
  "gik-react": "0.4.2",
  "gik-controlface": "0.5.0",
  "gik-agentface": "0.2.2",
  "gik-transport-http-sse": "0.2.2",
};

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
  componentsVersion,
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
  for (const [name, requestedVersion] of Object.entries({ ...coreVersions, "gik-components": componentsVersion })) {
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
<html lang="en"><meta charset="utf-8"><title>GIK package downloads</title>
<h1>GIK package downloads</h1>
<p>Released npm archives, verified against npm integrity metadata. These downloads are not an npm registry.</p>
<p><a href="manifest.json">Package manifest and npm sources</a> | <a href="SHA256SUMS">SHA-256 checksums</a></p>
<ul>${packages.map(({ name, version, file }) =>
    `<li><a href="${file}">${name}@${version}</a></li>`).join("\n")}</ul>
</html>
`);
  console.log(`Collected and integrity-verified ${packages.length} published packages into ${outputDirectory}`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const components = JSON.parse(await readFile(
    new URL("../packages/components/package.json", import.meta.url), "utf8",
  ));
  await collectPagesPackages({
    componentsVersion: process.env.PAGES_COMPONENTS_VERSION || components.version,
    outputDirectory: fileURLToPath(new URL("../src/browser-host/dist/vendor/", import.meta.url)),
  });
}
