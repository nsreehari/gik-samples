import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import {
  toFoundryPromptDefinition,
  type AgentFunctionToolDefinition,
  type AgentProvisioningTemplate,
} from "@gik-ai/agent-lifecycle-exp";
import type { BlueprintArtifact } from "@gik-ai/blueprint";

import { sampleAgentToolContracts } from "../src/shared/agent-tool-contracts";

interface ProvisioningManifest {
  schemaVersion: 1;
  provider: "foundry";
  agentId: string;
  description: string;
  model: string;
  projectEndpoint: string;
  blueprintFile: string;
  instructionsFile: string;
  tools: string[];
}

function parseArguments(args: readonly string[]): { manifest: string; out?: string } {
  let manifest = "";
  let out: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--manifest") manifest = args[++index] ?? "";
    else if (argument === "--out") out = args[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!manifest) throw new Error("--manifest is required");
  return { manifest, out };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Provisioning manifest requires a non-empty ${field}`);
  }
  return value.trim();
}

function parseManifest(value: unknown): ProvisioningManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Provisioning manifest must be an object");
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported provisioning manifest schemaVersion");
  if (manifest.provider !== "foundry") throw new Error("Provisioning manifest provider must be foundry");
  const agentId = requiredString(manifest.agentId, "agentId");
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(agentId)) {
    throw new Error("Provisioning manifest agentId is invalid");
  }
  if (!Array.isArray(manifest.tools)
    || manifest.tools.some((name) => typeof name !== "string" || !name.trim())) {
    throw new Error("Provisioning manifest tools must be an array of non-empty names");
  }
  const tools = [...new Set(manifest.tools.map((name) => String(name).trim()))];
  if (tools.length === 0) throw new Error("Provisioning manifest must declare at least one tool");
  const projectEndpoint = requiredString(manifest.projectEndpoint, "projectEndpoint");
  const endpoint = new URL(projectEndpoint);
  if (endpoint.protocol !== "https:"
    || !endpoint.hostname.endsWith(".services.ai.azure.com")
    || !/^\/api\/projects\/[^/]+\/?$/.test(endpoint.pathname)) {
    throw new Error("Provisioning manifest projectEndpoint must identify an HTTPS Foundry project");
  }
  return {
    schemaVersion: 1,
    provider: "foundry",
    agentId,
    description: requiredString(manifest.description, "description"),
    model: requiredString(manifest.model, "model"),
    projectEndpoint: endpoint.toString().replace(/\/$/, ""),
    blueprintFile: requiredString(manifest.blueprintFile, "blueprintFile"),
    instructionsFile: requiredString(manifest.instructionsFile, "instructionsFile"),
    tools,
  };
}

function resolveManifestFile(manifestPath: string, file: string, requireOwned: boolean): string {
  const manifestDirectory = dirname(manifestPath);
  const resolved = resolve(manifestDirectory, file);
  const pathFromDirectory = relative(manifestDirectory, resolved);
  if (requireOwned && pathFromDirectory.startsWith("..")) {
    throw new Error("instructionsFile must remain inside the agent provisioning directory");
  }
  return resolved;
}

async function generatePlan(manifestFile: string) {
  const manifestPath = resolve(manifestFile);
  const manifest = parseManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  const instructions = (await readFile(
    resolveManifestFile(manifestPath, manifest.instructionsFile, true),
    "utf8",
  )).trim();
  if (!instructions) throw new Error("Agent instructions must not be empty");

  const selectedTools = manifest.tools.map((name) => {
    const contract = sampleAgentToolContracts[name as keyof typeof sampleAgentToolContracts];
    if (!contract) throw new Error(`Unknown agent tool '${name}'`);
    return {
      type: "function",
      name,
      description: contract.description,
      parameters: contract.inputSchema,
      strict: true,
    } satisfies AgentFunctionToolDefinition;
  });
  const template: AgentProvisioningTemplate = {
    id: manifest.agentId,
    description: manifest.description,
    executionAuthority: "host",
    instructions: [instructions],
    tools: selectedTools,
  };
  const blueprint = JSON.parse(await readFile(
    resolveManifestFile(manifestPath, manifest.blueprintFile, false),
    "utf8",
  )) as BlueprintArtifact;

  return {
    format: "gik-project/1",
    provider: "foundry",
    blueprint: {
      id: blueprint.payload.id,
      version: blueprint.payload.version,
      artifact: blueprint,
    },
    profile: { agentId: manifest.agentId },
    projectEndpoint: manifest.projectEndpoint,
    agents: [{
      id: manifest.agentId,
      definition: toFoundryPromptDefinition(template, manifest.model),
    }],
  };
}

const options = parseArguments(process.argv.slice(2));
const plan = await generatePlan(options.manifest);
const serialized = `${JSON.stringify(plan, null, 2)}\n`;
if (options.out) {
  const outputPath = resolve(options.out);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
  console.log(outputPath);
} else {
  process.stdout.write(serialized);
}
