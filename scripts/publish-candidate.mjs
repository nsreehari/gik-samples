import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { verifyCandidate } from "./actions-evidence.mjs";

export function shouldPublish(metadata, candidate) {
  if (!metadata) return true;
  if (metadata.name !== candidate.name || metadata.version !== candidate.version
    || metadata.dist?.integrity !== candidate.integrity) throw new Error("Existing npm version differs from verified candidate");
  return false;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const candidate = verifyCandidate(".artifacts/candidate");
  const channel = process.env.CHANNEL;
  if (!["latest", "next"].includes(channel)) throw new Error("Invalid publication channel");
  const response = await fetch(`https://registry.npmjs.org/gik-components/${candidate.version}`,
    { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!response.ok && response.status !== 404) throw new Error(`Registry HTTP ${response.status}`);
  const metadata = response.ok ? await response.json() : null;
  if (shouldPublish(metadata, candidate)) {
    execFileSync("npm", ["exec", "--yes", "--package=npm@11.19.0", "--", "npm",
      "publish", ".artifacts/candidate/gik-components.tgz", "--ignore-scripts", "--tag", channel,
      "--access", "public", "--provenance"], { stdio: "inherit", shell: process.platform === "win32" });
  } else console.log("Exact verified candidate already exists on npm; continuing with mandatory independent consumer verification.");
}
