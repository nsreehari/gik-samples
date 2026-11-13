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
  execFileSync("gh", ["release", "create", `providers-v${after.version}`, "--repo", event.repository.full_name,
    "--target", event.after, "--title", `gik-service-providers ${after.version}`, "--generate-notes"], { stdio: "inherit" });
}
