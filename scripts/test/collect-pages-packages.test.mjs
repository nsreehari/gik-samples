import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectPagesPackages } from "../collect-pages-packages.mjs";

async function fixture(t) {
  const outputDirectory = await mkdtemp(join(tmpdir(), "gik-pages-packages-"));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const bytes = Buffer.from("published package archive");
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const fetcher = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith(".tgz")) return new Response(bytes);
    const [, name, version] = parsed.pathname.split("/");
    return Response.json({
      name, version,
      dist: { tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity },
    });
  };
  return { outputDirectory, bytes, fetcher };
}

test("collects all 11 exact npm archives with index, source metadata, and verifiable checksums", async (t) => {
  const options = await fixture(t);
  const manifest = await collectPagesPackages({ ...options, componentsVersion: "0.3.0" });
  assert.equal(manifest.packages.length, 11);
  assert.equal(manifest.packages.find(({ name }) => name === "gik-components").version, "0.3.0");
  const checksums = await readFile(join(options.outputDirectory, "SHA256SUMS"), "utf8");
  const index = await readFile(join(options.outputDirectory, "index.html"), "utf8");
  assert.ok(index.includes('href="../docs/"'));
  assert.ok(index.includes('href="../docs/site.css"'));
  for (const entry of manifest.packages) {
    const archive = await readFile(join(options.outputDirectory, entry.file));
    assert.deepEqual(archive, options.bytes);
    assert.ok(checksums.includes(`${createHash("sha256").update(archive).digest("hex")}  ${entry.file}\n`));
    assert.ok(index.includes(`href="${entry.file}"`));
    assert.equal(entry.tarballUrl, `https://registry.npmjs.org/${entry.name}/-/${entry.file}`);
  }
  assert.deepEqual(JSON.parse(await readFile(join(options.outputDirectory, "manifest.json"), "utf8")), manifest);
});

test("rejects tampered archives without producing a success manifest", async (t) => {
  const options = await fixture(t);
  await assert.rejects(collectPagesPackages({
    ...options, componentsVersion: "0.3.0",
    fetcher: (url) => url.endsWith(".tgz") ? new Response("tampered archive") : options.fetcher(url),
  }), /Integrity verification failed/);
  assert.deepEqual(await readdir(options.outputDirectory), []);
});

test("resolves the initial Pages latest selector to an exact published Components version", async (t) => {
  const options = await fixture(t);
  const manifest = await collectPagesPackages({
    ...options, componentsVersion: "latest",
    fetcher: (url) => options.fetcher(url.replace("/gik-components/latest", "/gik-components/0.2.1")),
  });
  const components = manifest.packages.find(({ name }) => name === "gik-components");
  assert.equal(components.version, "0.2.1");
  assert.equal(components.file, "gik-components-0.2.1.tgz");
});

test("retries npm visibility errors but fails immediately for other HTTP errors", async (t) => {
  const options = await fixture(t);
  let attempts = 0;
  const pauses = [];
  await collectPagesPackages({
    ...options, componentsVersion: "0.3.0",
    fetcher: (url) => ++attempts === 1 ? new Response(null, { status: 404 }) : options.fetcher(url),
    pause: async (ms) => { pauses.push(ms); },
  });
  assert.deepEqual(pauses, [10_000]);
  await assert.rejects(collectPagesPackages({
    ...options, componentsVersion: "0.3.0",
    fetcher: async () => new Response(null, { status: 403 }),
    pause: async () => assert.fail("Must not retry authorization errors"),
  }), /HTTP 403/);
});

test("rejects mismatched registry versions and non-npm tarball hosts", async (t) => {
  const options = await fixture(t);
  for (const mutate of [
    (metadata) => { metadata.version = "99.0.0"; },
    (metadata) => { metadata.dist.tarball = "https://example.com/archive.tgz"; },
  ]) {
    await assert.rejects(collectPagesPackages({
      ...options, componentsVersion: "0.3.0",
      fetcher: async (url) => {
        const metadata = await (await options.fetcher(url)).json();
        mutate(metadata);
        return Response.json(metadata);
      },
    }), /does not match|Unexpected npm tarball/);
  }
});
