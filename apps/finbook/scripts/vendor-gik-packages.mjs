import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const appRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(appRoot, "..", "..");
const gikRoot = resolve(process.env.GIK_SOURCE_DIR ?? join(repositoryRoot, "..", "generative-interaction-kernel"));
const outputRoot = join(appRoot, "vendor", "gik-packages");
const npmCli = process.env.npm_execpath;
const sources = [
  ["kernel", join(gikRoot, "packages", "kernel")],
  ["evaluators", join(gikRoot, "packages", "evaluators")],
  ["durable-runtime", join(gikRoot, "packages", "durable-runtime")],
  ["blueprint", join(gikRoot, "packages", "blueprint")],
  ["controlface", join(gikRoot, "packages", "controlface")],
  ["react", join(gikRoot, "packages", "react")],
  ["components", join(repositoryRoot, "packages", "components")],
];

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed${result.stderr ? `:\n${result.stderr}` : ""}`);
  }
  return result.stdout?.trim() ?? "";
}

function localizeGikDependencies(packageJson) {
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const name of Object.keys(packageJson[field] ?? {})) {
      if (name.startsWith("@gik-ai/")) packageJson[field][name] = "*";
    }
  }
}

if (!npmCli) throw new Error("Run vendoring through npm so npm_execpath is available.");
const sourceCommit = run("git", ["rev-parse", "HEAD"], gikRoot, true);
const temporaryRoot = await mkdtemp(join(tmpdir(), "finbook-gik-vendor-"));

try {
  await mkdir(outputRoot, { recursive: true });
  for (const entry of await readdir(outputRoot)) {
    if (entry.endsWith(".tgz")) await rm(join(outputRoot, entry));
  }

  const packages = [];
  for (const [sourceName, sourcePath] of sources) {
    const workRoot = join(temporaryRoot, sourceName);
    await mkdir(workRoot, { recursive: true });
    const packResult = JSON.parse(run(
      process.execPath,
      [npmCli, "pack", sourcePath, "--pack-destination", workRoot, "--ignore-scripts", "--json"],
      appRoot,
      true,
    ));
    const [packed] = packResult;
    run("tar", ["-xzf", join(workRoot, packed.filename), "-C", workRoot], appRoot);

    const extractedPackageJson = join(workRoot, "package", "package.json");
    const packageJson = JSON.parse(await readFile(extractedPackageJson, "utf8"));
    localizeGikDependencies(packageJson);
    await writeFile(extractedPackageJson, `${JSON.stringify(packageJson, null, 2)}\n`);

    const archive = join(outputRoot, packed.filename);
    run("tar", ["-czf", archive, "package"], workRoot);
    const content = await readFile(archive);
    packages.push({
      name: packageJson.name,
      version: packageJson.version,
      file: basename(archive),
      bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }

  await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify({
    format: "finbook-vendored-gik-packages/1",
    sourceCommit,
    packages,
  }, null, 2)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
