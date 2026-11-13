import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { changedFiles, git, providersVersion } from "./workflow-policy.mjs";
import { api } from "./actions-evidence.mjs";

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const pr = event.pull_request;
if (pr.head.repo.full_name !== event.repository.full_name) throw new Error("No versioning authority for fork branches");
const path = "packages/service-providers/package.json";
if (git("ls-tree", "--name-only", pr.head.sha, path)) {
  const base = git("ls-tree", "--name-only", pr.base.sha, path) ? JSON.parse(git("show", `${pr.base.sha}:${path}`)) : null;
  const head = JSON.parse(git("show", `${pr.head.sha}:${path}`));
  const version = providersVersion(changedFiles(pr.base.sha, pr.head.sha), base, head, pr.labels.map(({ name }) => name));
  if (version && version !== head.version) {
    const repository = `repos/${event.repository.full_name}`;
    if (api(`${repository}/git/ref/heads/${pr.head.ref}`).object.sha !== pr.head.sha
      || api(`${repository}/git/ref/heads/main`).object.sha !== pr.base.sha) throw new Error("PR/base advanced; await the newer versioning event");
    const lock = JSON.parse(git("show", `${pr.head.sha}:package-lock.json`));
    if (lock.lockfileVersion !== 3 || lock.packages?.["packages/service-providers"]?.name !== head.name) throw new Error("Missing provider workspace lock metadata");
    lock.packages["packages/service-providers"].version = version;
    const post = (resource, value) => JSON.parse(execFileSync("gh", ["api", "--method", "POST", `${repository}/${resource}`, "--input", "-"], {
      encoding: "utf8", input: JSON.stringify(value),
    }));
    const tree = post("git/trees", {
      base_tree: git("rev-parse", `${pr.head.sha}^{tree}`),
      tree: [[path, { ...head, version }], ["package-lock.json", lock]].map(([file, value]) => ({
        path: file, mode: "100644", type: "blob",
        sha: post("git/blobs", { content: `${JSON.stringify(value, null, 2)}\n`, encoding: "utf-8" }).sha,
      })),
    });
    const commit = post("git/commits", {
      message: `chore: prepare gik-service-providers ${version}\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`,
      tree: tree.sha, parents: [pr.head.sha],
    });
    execFileSync("gh", ["api", "--method", "PATCH", `${repository}/git/refs/heads/${pr.head.ref}`, "--input", "-"], {
      input: JSON.stringify({ sha: commit.sha, force: false }), stdio: ["pipe", "inherit", "inherit"],
    });
  }
}
