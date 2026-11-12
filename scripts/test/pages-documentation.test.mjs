import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const repository = new URL("../../", import.meta.url);
const publicDirectory = new URL("src/browser-host/public/", repository);
const pages = ["docs/", "getting-started/"];
const hostRoutes = new Set(["", "storybook/", "scenarios/", "provisioning/", "vendor/"]);
const hrefs = (html) => [...html.matchAll(/\bhref="([^"]+)"/g)].map((match) => match[1]);
const ids = (html) => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));

test("documentation resources, anchors, and sample launches resolve at root and nested deployment bases", async () => {
  const catalog = JSON.parse(await readFile(new URL("src/bootstrap/catalog.json", repository), "utf8"));
  const blueprintIds = new Set(catalog.entries.map(({ id }) => id));
  for (const base of ["/", "/gik-samples/", "/preview/version/"]) {
    for (const route of pages) {
      const pageUrl = new URL(`${base}${route}`, "https://example.test");
      const html = await readFile(new URL(`${route}index.html`, publicDirectory), "utf8");
      for (const href of hrefs(html)) {
        const target = new URL(href, pageUrl);
        if (target.origin !== pageUrl.origin) continue;
        assert.ok(target.pathname.startsWith(base), `${href} escapes deployment base ${base}`);
        const path = target.pathname.slice(base.length);
        if (target.searchParams.has("b")) {
          assert.ok(blueprintIds.has(target.searchParams.get("b")), `${href} launches an unknown Blueprint`);
        }
        if (hostRoutes.has(path)) continue;
        const file = new URL(path.endsWith("/") ? `${path}index.html` : path, publicDirectory);
        await access(file);
        if (target.hash) {
          const targetHtml = await readFile(file, "utf8");
          assert.ok(ids(targetHtml).has(decodeURIComponent(target.hash.slice(1))), `${href} has a missing anchor`);
        }
      }
    }
  }
});

test("documentation links into this repository identify existing source and owning documents", async () => {
  for (const route of pages) {
    const html = await readFile(new URL(`${route}index.html`, publicDirectory), "utf8");
    for (const href of hrefs(html)) {
      const target = new URL(href, "https://example.test");
      if (target.hostname !== "github.com") continue;
      const parts = target.pathname.split("/").filter(Boolean);
      if (parts[0] !== "nsreehari" || parts[1] !== "gik-samples") continue;
      if (parts.length === 2) continue;
      assert.ok(["blob", "tree"].includes(parts[2]), `Unsupported source link ${href}`);
      assert.equal(parts[3], "main", `Source link does not follow the public default branch: ${href}`);
      await access(new URL(parts.slice(4).join("/"), repository));
    }
  }
});
