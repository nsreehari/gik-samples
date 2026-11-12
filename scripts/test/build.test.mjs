import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("Pages builds skip the separate Finbook bundle without changing the default build", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "gik-build-policy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runner = join(directory, "npm-fixture.mjs");
  await writeFile(runner, `import { appendFileSync } from "node:fs";
appendFileSync(process.env.BUILD_CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");`);
  for (const siteOnly of [false, true]) {
    const calls = join(directory, `${siteOnly}.jsonl`);
    execFileSync(process.execPath, [
      fileURLToPath(new URL("../build.mjs", import.meta.url)), ...(siteOnly ? ["--site-only"] : []),
    ], { env: { ...process.env, npm_execpath: runner, BUILD_CALLS: calls } });
    const invoked = (await readFile(calls, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(invoked.some((args) => args.includes("finbook:build")), !siteOnly);
    assert.ok(invoked.some((args) => args.includes("gik-components")));
    assert.ok(invoked.some((args) => args.includes("scripts/validate-bootstrap.ts")));
    assert.ok(invoked.some((args) => args.includes("storybook")));
    assert.ok(invoked.some((args) => args.includes("vite")));
  }
});
