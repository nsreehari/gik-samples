import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { assertComponentsVersionIncrease, git } from "./workflow-policy.mjs";

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const path = "packages/components/package.json";
const before = JSON.parse(git("show", `${event.before}:${path}`));
const after = JSON.parse(git("show", `${event.after}:${path}`));
if (before.version === after.version) {
  console.log("No version change; no npm release.");
} else if (before.version.includes("-") || after.version.includes("-")) {
  console.log("Prerelease authoring/promotion remains manual; no automatic release.");
} else {
  assertComponentsVersionIncrease(before.version, after.version);
  const tag = `components-v${after.version}`;
  const repository = event.repository.full_name;
  const remote = JSON.parse(execFileSync("gh", ["api", `repos/${repository}/git/ref/heads/main`], { encoding: "utf8" }));
  if (remote.object.sha !== event.after) throw new Error("main advanced; do not release an outdated commit");
  if (git("tag", "--list", tag) && git("rev-list", "-n", "1", tag) !== event.after) {
    throw new Error(`Existing tag ${tag} targets another commit`);
  }
  const releases = JSON.parse(execFileSync("gh", ["api", `repos/${repository}/releases?per_page=100`], { encoding: "utf8" }));
  const existing = releases.find((release) => release.tag_name === tag);
  if (existing) {
    if (existing.draft || existing.prerelease) throw new Error("Existing release is not a published stable release");
    const target = git("rev-list", "-n", "1", tag);
    if (target !== event.after) throw new Error(`Existing release ${tag} targets another commit`);
    console.log(`Release ${tag} already exists.`);
  } else {
    execFileSync("gh", ["release", "create", tag, "--repo", repository, "--target", event.after,
      "--title", `gik-components ${after.version}`, "--generate-notes"], { stdio: "inherit" });
  }
}
