import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

const packages = [
  "agent-lifecycle-exp",
  "blueprint",
  "blueprint-agent-host",
  "controlface",
  "durable-runtime",
  "evaluators",
  "kernel",
  "react",
];

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(process.env.GIK_SOURCE_DIR ?? join(repositoryRoot, "..", "gik-fresh"));
const outputRoot = join(repositoryRoot, "vendor", "gik-packages");
const npmCli = process.env.npm_execpath;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed${result.stderr ? `:\n${result.stderr}` : ""}`);
  }
  return result.stdout?.trim() ?? "";
}

async function filesUnder(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(child));
    else files.push(child);
  }
  return files;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

const packagePaths = packages.map((name) => `packages/${name}`);
const dirtyPackages = run(
  "git",
  ["status", "--porcelain", "--", ...packagePaths],
  { cwd: sourceRoot, capture: true },
);
if (dirtyPackages) {
  throw new Error(`Refusing to vendor modified GIK package sources:\n${dirtyPackages}`);
}

const sourceCommit = run("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, capture: true });
const sourceRepository = run("git", ["remote", "get-url", "origin"], {
  cwd: sourceRoot,
  capture: true,
});
const temporaryRoot = await mkdtemp(join(tmpdir(), "gik-package-vendor-"));

try {
  await mkdir(outputRoot, { recursive: true });
  for (const entry of await readdir(outputRoot)) {
    if (entry.endsWith(".tgz")) await rm(join(outputRoot, entry));
  }

  const artifacts = [];
  for (const packageDirectory of packages) {
    const workDirectory = join(temporaryRoot, packageDirectory);
    await mkdir(workDirectory, { recursive: true });
    if (!npmCli) throw new Error("Run vendoring through npm so npm_execpath is available.");
    const packJson = run(
      process.execPath,
      [
        npmCli,
        "pack",
        join(sourceRoot, "packages", packageDirectory),
        "--pack-destination",
        workDirectory,
        "--ignore-scripts",
        "--json",
      ],
      { cwd: repositoryRoot, capture: true },
    );
    const [packed] = JSON.parse(packJson);
    const originalArchive = join(workDirectory, packed.filename);
    run("tar", ["-xzf", originalArchive, "-C", workDirectory]);

    const extractedPackage = join(workDirectory, "package");
    for (const file of await filesUnder(extractedPackage)) {
      if (file.endsWith(".map")) {
        await rm(file);
      } else if (file.endsWith(".js")) {
        const content = await readFile(file, "utf8");
        await writeFile(file, content.replace(/\r?\n\/\/# sourceMappingURL=.*?(?=\r?\n|$)/g, ""));
      }
    }

    const finalArchive = join(outputRoot, packed.filename);
    const tarArchive = join(workDirectory, "package.tar");
    run(
      "tar",
      ["--mtime", "@0", "-cf", tarArchive, "package"],
      { cwd: workDirectory },
    );
    await writeFile(finalArchive, gzipSync(await readFile(tarArchive), { level: 9, mtime: 0 }));
    artifacts.push({
      name: packed.name,
      version: packed.version,
      file: basename(finalArchive),
      bytes: (await readFile(finalArchive)).byteLength,
      sha256: await sha256(finalArchive),
    });
  }

  const manifest = {
    format: "gik-vendored-packages/1",
    sourceRepository,
    sourceCommit,
    excluded: ["source map files", "sourceMappingURL comments"],
    packages: artifacts,
  };
  await writeFile(
    join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
