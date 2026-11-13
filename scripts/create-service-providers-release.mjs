import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { git, assertComponentsVersionIncrease, providersVersion } from "./workflow-policy.mjs";

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const path = "packages/service-providers/package.json";
const before = git("ls-tree", "--name-only", event.before, path) ? JSON.parse(git("show", `${event.before}:${path}`)) : null;
const after = JSON.parse(git("show", `${event.after}:${path}`));
providersVersion([], before, after, []);
if (!before || before.version !== after.version) {
  if (before) assertComponentsVersionIncrease(before.version, after.version);
  const remote = JSON.parse(execFileSync("gh", ["api", `repos/${event.repository.full_name}/git/ref/heads/main`], { encoding: "utf8" }));
  if (remote.object.sha !== event.after) throw new Error("main advanced; do not release an outdated provider commit");
  const tag = `providers-v${after.version}`;
  const refs = JSON.parse(execFileSync("gh", ["api", `repos/${event.repository.full_name}/git/matching-refs/tags/${tag}`], { encoding: "utf8" }));
  const existing = refs.find((ref) => ref.ref === `refs/tags/${tag}`);
  if (existing && (existing.object.type !== "commit" || existing.object.sha !== event.after)) throw new Error("Existing provider tag has a different immutable identity");
  execFileSync("gh", ["release", "create", tag, "--repo", event.repository.full_name,
    "--target", event.after, "--title", `gik-service-providers ${after.version}`, "--generate-notes"], { stdio: "inherit" });
}
