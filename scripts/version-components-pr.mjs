import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { changedFiles, git, isManualPrerelease, needsComponentsRelease, nextComponentsVersion } from "./workflow-policy.mjs";

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const pr = event.pull_request;
if (pr.head.repo.full_name !== event.repository.full_name) {
  throw new Error("Fork release changes require a maintainer-owned branch; no write token is sent to forks");
}
const path = "packages/components/package.json";
// Read the PR tree as data. Never check out or execute PR code in this privileged workflow.
const base = JSON.parse(git("show", `${pr.base.sha}:${path}`));
const head = JSON.parse(git("show", `${pr.head.sha}:${path}`));
if (head.name !== base.name) throw new Error("Automatic releases cannot rename the package");
const files = changedFiles(pr.base.sha, pr.head.sha);
const labels = pr.labels.map(({ name }) => name);
if (isManualPrerelease(base.version, head.version, labels)) {
  console.log("Explicit prerelease authoring/promotion; maintain the reviewed version manually.");
} else if (!needsComponentsRelease(files, base, head)) {
  console.log("No published Components inputs changed.");
} else {
  const version = nextComponentsVersion(base.version, labels);
  if (head.version !== version) {
    const api = (resource, body) => JSON.parse(execFileSync("gh", [
      "api", ...(body ? ["--method", "POST", "--input", "-"] : []),
      `repos/${event.repository.full_name}/${resource}`,
    ], { encoding: "utf8", ...(body ? { input: JSON.stringify(body) } : {}) }));
    // The branch head must still be the reviewed event head before the file update.
    const current = JSON.parse(execFileSync("gh", [
      "api", `repos/${event.repository.full_name}/git/ref/heads/${pr.head.ref}`,
    ], { encoding: "utf8" }));
    if (current.object.sha !== pr.head.sha) throw new Error("PR advanced; wait for its newer versioning run");
    if (api("git/ref/heads/main").object.sha !== pr.base.sha) {
      throw new Error("Base advanced; update the implementation PR before versioning");
    }
    const lockPath = "package-lock.json";
    const lock = JSON.parse(git("show", `${pr.head.sha}:${lockPath}`));
    if (lock.lockfileVersion !== 3 || lock.packages?.["packages/components"]?.name !== head.name) {
      throw new Error("Expected locked Components workspace metadata");
    }
    lock.packages["packages/components"].version = version;
    const updates = [[path, { ...head, version }], [lockPath, lock]];
    const entries = updates.map(([file, value]) => {
      const blob = api("git/blobs", { content: `${JSON.stringify(value, null, 2)}\n`, encoding: "utf-8" });
      return { path: file, mode: "100644", type: "blob", sha: blob.sha };
    });
    const tree = api("git/trees", {
      base_tree: git("rev-parse", `${pr.head.sha}^{tree}`),
      tree: entries,
    });
    const commit = api("git/commits", {
      message: `chore: prepare gik-components ${version}\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`,
      tree: tree.sha, parents: [pr.head.sha],
    });
    execFileSync("gh", ["api", "--method", "PATCH",
      `repos/${event.repository.full_name}/git/refs/heads/${pr.head.ref}`, "--input", "-"], {
      input: JSON.stringify({ sha: commit.sha, force: false }), stdio: ["pipe", "inherit", "inherit"],
    });
  }
  console.log(`Components version intent: ${version}`);
}
