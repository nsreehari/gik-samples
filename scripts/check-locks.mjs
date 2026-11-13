import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

export function checkLocks(root = ".") {
  for (const [directory, workspaces] of [
    [".", ["packages/components", "packages/service-providers"]],
    ["apps/finbook", ["reference-app-host/browser-host", "mcp-server"]],
    ["packages/mcp-server", []],
  ]) {
    let lock;
    try { lock = JSON.parse(readFileSync(join(root, directory, "package-lock.json"), "utf8")); }
    catch (cause) {
      if (cause.code === "ENOENT") {
        throw new Error(`Missing reproducible lock: ${directory}/package-lock.json; generate with npm 11.19.0 before rollout`, { cause });
      }
      throw new Error(`Unable to read or parse reproducible lock: ${directory}/package-lock.json`, { cause });
    }
    if (lock.lockfileVersion !== 3 || !lock.packages) throw new Error(`Expected npm v3 lock: ${directory}`);
    for (const workspace of ["", ...workspaces]) {
      const pkg = JSON.parse(readFileSync(join(root, directory, workspace, "package.json"), "utf8"));
      const entry = lock.packages[workspace];
      if (!entry || entry.version !== pkg.version) throw new Error(`Stale locked workspace version: ${directory}/${workspace}`);
      for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        if (!isDeepStrictEqual(entry[section] || {}, pkg[section] || {})) {
          throw new Error(`Stale ${section} lock: ${directory}/${workspace}`);
        }
      }
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) checkLocks();
