import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspectTarball, sha256 } from "./actions-evidence.mjs";

const source = () => JSON.parse(readFileSync("node_modules/gik-service-providers/package.json", "utf8"));
function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: "pipe", maxBuffer: 20 * 1024 * 1024, ...options });
}
async function consumer(packageSpec) {
  const temporary = mkdtempSync(join(tmpdir(), "gik-service-providers-"));
  try {
    writeFileSync(join(temporary, "package.json"), JSON.stringify({ private: true, type: "module" }));
    run("npm", ["exec", "--yes", "--package=npm@11.19.0", "--", "npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", packageSpec, "typescript@^5.9.2", "@types/node@^24"], { cwd: temporary });
    const installed = JSON.parse(readFileSync(join(temporary, "node_modules", "gik-service-providers", "package.json"), "utf8"));
    assert.equal(installed.version, source().version);
    const gmail = readFileSync(join(temporary, "node_modules", "gik-service-providers", "dist", "gmail.js"), "utf8");
    assert.doesNotMatch(gmail, /(?:from\s*|import\s*[\(])["'][^"']*(?:croner|scheduler)/);
    writeFileSync(join(temporary, "check.ts"), `
import { createGmailServiceKind, type GmailConnection } from "gik-service-providers/gmail";
import { createSchedulerServiceKind } from "gik-service-providers/scheduler";
import { createGitHubContextStoreServiceKind, type GitHubContextStoreConnection } from "gik-service-providers/github-context-store";
import { createFoundryServiceKind, type FoundryResponseWorkspace } from "gik-service-providers/foundry";
import type { ServiceKindFactory } from "gik-controlface/services";
const workspace: FoundryResponseWorkspace = { readProposal: () => ({ report: true }), close: () => {} };
const kinds: ServiceKindFactory[] = [createGmailServiceKind(), createSchedulerServiceKind(), createGitHubContextStoreServiceKind(), createFoundryServiceKind({ openResponseWorkspace: () => workspace })];
const connection: GmailConnection = { request: async () => new Response("{}") };
const github: GitHubContextStoreConnection = { request: async () => new Response("{}") };
console.log(kinds.length, connection, github);
`);
    run(process.execPath, [join(temporary, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "check.ts"], { cwd: temporary });
    run(process.execPath, ["--input-type=module", "-e", `
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const foundryIsolation = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "croner" || specifier.startsWith("croner/") || /^gik-service-providers\\/(gmail|scheduler|github-context-store)$/.test(specifier) || /\\/(gmail|scheduler|github-context-store)\\.js$/.test(specifier)) throw new Error("Foundry eagerly loaded another provider");
  return next(specifier, context);
} });
const foundry = await import("gik-service-providers/foundry");
foundryIsolation.deregister();
const isolation = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "croner" || specifier.endsWith("/scheduler.js")) throw new Error("Gmail eagerly loaded scheduler code");
  return next(specifier, context);
} });
const gmail = await import("gik-service-providers/gmail");
isolation.deregister();
const scheduler = await import("gik-service-providers/scheduler");
const github = await import("gik-service-providers/github-context-store");
assert.equal(gmail.createGmailServiceKind().manifest.id, "gmail");
assert.equal(scheduler.createSchedulerServiceKind().manifest.id, "cron-scheduler");
assert.equal(github.createGitHubContextStoreServiceKind().manifest.id, "github-context-store");
assert.equal(foundry.createFoundryServiceKind().manifest.id, "foundry-agent");
const { ServiceKindRegistry } = await import("gik-controlface/services");
const registry = new ServiceKindRegistry({
  hostCapabilities: ["foundry-executor", "credential-resolver"],
  resolveCredential: async () => "consumer-test-key",
  authorizeEndpoint: () => true,
});
registry.register(foundry.createFoundryServiceKind({ fetch: async (_url, init) => {
  const request = JSON.parse(init.body);
  assert.equal(request.agentName, "consumer");
  assert.deepEqual(request.allowedTools, []);
  return Response.json({ conversationId: "consumer", responseId: "response", reply: '{"markdown":"Packaged report"}', toolCalls: [] });
} }));
const adapter = await registry.materialize({ blueprintId: "consumer", blueprintRevision: "1", serviceId: "foundry" }, {
  kind: "foundry-agent", version: "1",
  config: { endpoint: "https://foundry.example", credentialRef: "consumer/key", agent: "consumer", agentTools: [], responseMode: "json" },
  operations: { report: { operation: "chat", contract: "report/v1", settlement: { transform: { kind: "jsonata", expr: "$" } } } },
});
assert.deepEqual((await adapter.execute({
  id: "consumer-request", service: "foundry", operation: "chat", input: { message: "Report" }, createdAt: "now",
}, {})).output, { markdown: "Packaged report" });
await assert.rejects(import("gik-service-providers"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
`], { cwd: temporary });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

const command = process.argv[2];
if (command === "verify-consumer") {
  const root = JSON.parse(readFileSync("package.json", "utf8"));
  const manifest = source();
  assert.equal(manifest.version, root.dependencies["gik-service-providers"]);
  const locked = JSON.parse(readFileSync("package-lock.json", "utf8")).packages["node_modules/gik-service-providers"];
  const vendor = JSON.parse(readFileSync("src/browser-host/dist/vendor/manifest.json", "utf8"))
    .packages.find(({ name }) => name === "gik-service-providers");
  assert.equal(vendor.version, manifest.version);
  assert.equal(vendor.integrity, locked.integrity);
  const archive = `src/browser-host/dist/vendor/${vendor.file}`;
  assert.equal(sha256(readFileSync(archive)), vendor.sha256);
  inspectTarball(archive, manifest);
  await consumer(resolve(archive));
  console.log("Official npm Provider archive, independent subpaths, declarations, Foundry execution and absent root import verified");
} else throw new Error("Unknown service providers distribution command");
