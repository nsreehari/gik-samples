import { readFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { git } from "./actions-evidence.mjs";
import { validateCoreVersions } from "./collect-pages-packages.mjs";

function librariesAt(commit, runGit) {
  const root = JSON.parse(runGit("show", `${commit}:package.json`));
  const libraries = {};
  for (const [name, directory] of [["gik-components", "packages/components"], ["gik-service-providers", "packages/service-providers"]]) {
    const dependency = root.dependencies?.[name];
    const legacy = dependency === `file:${directory}`;
    const version = legacy ? JSON.parse(runGit("show", `${commit}:${directory}/package.json`)).version : dependency;
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? "")) throw new Error(`Exact source version required for ${name}`);
    libraries[name] = { version, lockPath: legacy ? directory : `node_modules/${name}`, legacy };
  }
  return { root, libraries };
}

export function releaseInputsAt(commit, runGit = git) {
  try {
    const { root, libraries } = librariesAt(commit, runGit);
    const lock = JSON.parse(runGit("show", `${commit}:package-lock.json`));
    if (lock.lockfileVersion !== 3 || lock.packages?.[""]?.version !== root.version) throw new Error("Stale source lock");
    for (const { version, lockPath } of Object.values(libraries)) {
      if (lock.packages?.[lockPath]?.version !== version) throw new Error("Stale source library lock");
    }
    for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
      if (!isDeepStrictEqual(lock.packages[""][key] || {}, root[key] || {})) throw new Error("Stale source lock constraints");
    }
    return validateCoreVersions(JSON.parse(runGit("show", `${commit}:scripts/pages-core-versions.json`)));
  } catch (cause) {
    throw new Error("Pages source must include a matching committed root lock and exact structured core versions; use a post-rollout pinned ref", { cause });
  }
}

export function planRelease({ event, kind, releaseRef, sha }, runGit = git) {
  let ref = sha;
  let publish = false;
  let pages = true;
  let channel = "latest";
  if (kind === "release") {
    if (event.release.draft || !/^components-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(event.release.tag_name)) {
      throw new Error("Not a published Components release");
    }
    ref = event.release.tag_name;
    publish = true;
    channel = event.release.prerelease ? "next" : "latest";
  } else if (kind === "workflow_dispatch") {
    ref = releaseRef;
    if (!/^(?:[a-f0-9]{40}|components-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.test(ref || "")) {
      throw new Error("Rollback requires a pinned Components tag or full commit SHA");
    }
  } else if (kind === "push") {
    const after = librariesAt(event.after, runGit).libraries["gik-components"];
    if (after.legacy) pages = librariesAt(event.before, runGit).libraries["gik-components"].version === after.version;
  } else throw new Error("Unsupported release event");
  const commit = runGit("rev-parse", `${ref}^{commit}`);
  const { libraries } = librariesAt(commit, runGit);
  const pkg = libraries["gik-components"];
  runGit("merge-base", "--is-ancestor", commit, "origin/main");
  if (publish) {
    if (event.release.tag_name !== `components-v${pkg.version}`
      || event.release.prerelease !== pkg.version.includes("-")
      || commit !== runGit("rev-parse", "origin/main")) throw new Error("Release tag, channel or main mismatch");
  }
  if (!pkg.legacy) publish = false;
  return { commit, version: pkg.version, providers_version: libraries["gik-service-providers"].version, channel, pages, publish };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2]) throw new Error("Unsupported Pages planner command; package release promotion was retired");
  const result = planRelease({
    event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
    kind: process.env.GITHUB_EVENT_NAME, releaseRef: process.env.RELEASE_REF, sha: process.env.GITHUB_SHA,
  });
  result.core_versions = JSON.stringify(releaseInputsAt(result.commit));
  for (const [name, value] of Object.entries(result)) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}
