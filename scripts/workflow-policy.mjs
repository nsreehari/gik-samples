import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function classifyChanges(files) {
  const result = { full: false, finbook: false, mcp: false, pages: false };
  for (const file of files) {
    if (file.startsWith("apps/finbook/")) {
      if (!file.endsWith(".md")) result.finbook = true;
    } else if (file.startsWith("packages/mcp-server/")) {
      if (!file.endsWith(".md")) result.mcp = true;
    } else if (file.startsWith("packages/components/")) {
      result.full = true;
      result.pages = true;
    } else if (/^(src|storybook)\//.test(file)) {
      result.full = true;
      result.pages = true;
    } else if (file.startsWith(".github/workflows/") || file.startsWith("scripts/")
      || /^(package(-lock)?\.json|vitest\.config\.ts|tsconfig.*\.json)$/.test(file)) {
      result.full = true;
      result.finbook = true;
      result.mcp = true;
      result.pages = true;
    } else if (!file.endsWith(".md") && !/^(docs\/|\.github\/|LICENSE$|\.gitignore$)/.test(file)) {
      // Unknown build inputs take the conservative path.
      result.full = true;
      result.finbook = true;
      result.mcp = true;
      result.pages = true;
    }
  }
  if (result.full) result.finbook = true;
  return result;
}

export function nextComponentsVersion(version, labels) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) throw new Error("Automatic versioning requires a stable semantic version");
  if (labels.includes("release:major") && labels.includes("release:minor")) {
    throw new Error("Choose only one release intent: release:major or release:minor");
  }
  const parts = match.slice(1).map(Number);
  const index = labels.includes("release:major") ? 0 : labels.includes("release:minor") ? 1 : 2;
  parts[index] += 1;
  for (let i = index + 1; i < parts.length; i += 1) parts[i] = 0;
  return parts.join(".");
}

export function isManualPrerelease(baseVersion, headVersion, labels) {
  if (!baseVersion.includes("-") && !headVersion.includes("-")) return false;
  if (!labels.includes("release:prerelease")) {
    throw new Error("Prerelease authoring/promotion requires the explicit release:prerelease label");
  }
  if (labels.includes("release:major") || labels.includes("release:minor")) {
    throw new Error("Prerelease intent cannot be combined with automatic minor/major intent");
  }
  return true;
}

export function needsComponentsRelease(files, baseManifest, headManifest) {
  return files.some((file) => file.startsWith("packages/components/")
    && !/^packages\/components\/(test\/|.*\.test\.[^.]+$)/.test(file)
    && file !== "packages/components/package.json")
    || files.includes("packages/components/package.json")
      && JSON.stringify({ ...baseManifest, version: null }) !== JSON.stringify({ ...headManifest, version: null });
}

export function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function changedFiles(base, head) {
  return execFileSync("git", ["diff", "--name-only", "-z", `${base}...${head}`], { encoding: "utf8" })
    .split("\0").filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const files = event.pull_request
    ? changedFiles(event.pull_request.base.sha, event.pull_request.head.sha)
    : null;
  const result = files ? classifyChanges(files) : { full: true, finbook: true, mcp: true, pages: true };
  if (event.pull_request) {
    const path = "packages/components/package.json";
    const base = JSON.parse(git("show", `${event.pull_request.base.sha}:${path}`));
    const head = JSON.parse(git("show", `${event.pull_request.head.sha}:${path}`));
    if (needsComponentsRelease(files, base, head)
      && !isManualPrerelease(base.version, head.version, event.pull_request.labels.map(({ name }) => name))) {
      const expected = nextComponentsVersion(base.version, event.pull_request.labels.map(({ name }) => name));
      if (head.version !== expected) {
        throw new Error(`Components must be ${expected}; wait for the version bot or update this PR's manifest`);
      }
    }
  }
  for (const [name, value] of Object.entries(result)) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  console.log(JSON.stringify(result));
}
