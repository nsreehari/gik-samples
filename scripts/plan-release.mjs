import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { git, verifyCandidate } from "./actions-evidence.mjs";
import { validateCoreVersions } from "./collect-pages-packages.mjs";

export function releaseInputsAt(commit, runGit = git) {
  try {
    const root = JSON.parse(runGit("show", `${commit}:package.json`));
    const components = JSON.parse(runGit("show", `${commit}:packages/components/package.json`));
    const lock = JSON.parse(runGit("show", `${commit}:package-lock.json`));
    if (lock.lockfileVersion !== 3 || lock.packages?.[""]?.version !== root.version
      || lock.packages?.["packages/components"]?.version !== components.version) throw new Error("Stale source lock");
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
    const before = JSON.parse(runGit("show", `${event.before}:packages/components/package.json`));
    const after = JSON.parse(runGit("show", `${event.after}:packages/components/package.json`));
    // The release event owns both publishing and Pages for version-changing merges.
    pages = before.version === after.version;
  } else throw new Error("Unsupported release event");
  const commit = runGit("rev-parse", `${ref}^{commit}`);
  const pkg = JSON.parse(runGit("show", `${commit}:packages/components/package.json`));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) throw new Error("Invalid package version");
  runGit("merge-base", "--is-ancestor", commit, "origin/main");
  if (publish) {
    if (event.release.tag_name !== `components-v${pkg.version}`
      || event.release.prerelease !== pkg.version.includes("-")
      || commit !== runGit("rev-parse", "origin/main")) throw new Error("Release tag, channel or main mismatch");
  }
  return { commit, version: pkg.version, channel, pages, publish };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "promote") {
    const candidate = verifyCandidate(".artifacts/candidate", { allowSameTree: true });
    candidate.promotedFromCommit = candidate.commit;
    candidate.commit = git("rev-parse", "HEAD");
    writeFileSync(".artifacts/candidate/candidate.json", JSON.stringify(candidate, null, 2) + "\n");
  } else {
    const result = planRelease({
      event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
      kind: process.env.GITHUB_EVENT_NAME, releaseRef: process.env.RELEASE_REF, sha: process.env.GITHUB_SHA,
    });
    result.core_versions = JSON.stringify(releaseInputsAt(result.commit));
    for (const [name, value] of Object.entries(result)) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
    }
  }
}
