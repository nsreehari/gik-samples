import {
  toCopilotAgentMarkdown,
  toFoundryPromptDefinition,
  type AgentProvisioningTemplate,
} from "@gik-ai/agent-lifecycle-exp";
import type { BlueprintArtifact } from "@gik-ai/blueprint";

export type ProvisioningProvider = "copilot" | "foundry";

export interface AgentProvisioningProfile {
  schemaVersion: 1;
  blueprintId: string;
  provider: ProvisioningProvider;
  agentId: string;
  description: string;
  instructions: string;
}

export interface CopilotProvisioningPlan {
  format: "gik-project/1";
  provider: "copilot";
  blueprint: { id: string; version: string; artifact: BlueprintArtifact };
  profile: { agentId: string; workspaceRootId: string; model: string };
  files: Array<{ path: string; content: string }>;
}

export interface FoundryProvisioningPlan {
  format: "gik-project/1";
  provider: "foundry";
  blueprint: { id: string; version: string; artifact: BlueprintArtifact };
  profile: { agentId: string };
  projectEndpoint: string;
  agents: Array<{ id: string; definition: ReturnType<typeof toFoundryPromptDefinition> }>;
}

export type AgentProvisioningPlan = CopilotProvisioningPlan | FoundryProvisioningPlan;

type ProvisioningServiceConfig = {
  model: string;
  projectEndpoint?: string;
  workspaceRootId?: string;
};

export function safeAgentId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(id)) {
    throw new Error("Agent ID must start with a letter and contain only letters, numbers, '.', '_' or '-'");
  }
  return id;
}

export function defaultProvisioningProfile(blueprint: BlueprintArtifact): AgentProvisioningProfile {
  return {
    schemaVersion: 1,
    blueprintId: blueprint.payload.id,
    provider: "copilot",
    agentId: `${blueprint.payload.id}-agent`.replace(/[^A-Za-z0-9._-]/g, "-"),
    description: `Grounded agent for the ${blueprint.payload.id} Blueprint.`,
    instructions: "Use the selected Blueprint as the governed source of application identity and behavior. Read relevant workspace state before acting, keep changes narrow, and report only verified outcomes.",
  };
}

export function validateProvisioningProfile(
  profile: AgentProvisioningProfile,
  blueprintId = profile.blueprintId,
): AgentProvisioningProfile {
  if (profile.schemaVersion !== 1) throw new Error("Unsupported provisioning profile version");
  if (profile.blueprintId !== blueprintId) throw new Error("Provisioning profile Blueprint identity mismatch");
  if (profile.provider !== "copilot" && profile.provider !== "foundry") {
    throw new Error("Provisioning provider must be copilot or foundry");
  }
  const agentId = safeAgentId(profile.agentId);
  const description = profile.description.trim();
  const instructions = profile.instructions.trim();
  if (!description) throw new Error("Description is required");
  if (!instructions) throw new Error("Instructions are required");
  return {
    schemaVersion: 1,
    blueprintId: profile.blueprintId,
    provider: profile.provider,
    agentId,
    description,
    instructions,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function serviceDeclarations(blueprint: BlueprintArtifact): Record<string, unknown>[] {
  const declarations: Record<string, unknown>[] = [];
  const collect = (services: unknown) => {
    if (!isRecord(services)) return;
    Object.values(services).forEach((service) => {
      if (isRecord(service)) declarations.push(service);
    });
  };
  collect(blueprint.payload.services);
  const recipes = blueprint.payload.serviceRecipes;
  if (Array.isArray(recipes)) {
    recipes.forEach((recipe) => {
      if (!isRecord(recipe) || !Array.isArray(recipe.implementationPrograms)) return;
      recipe.implementationPrograms.forEach((program) => {
        if (isRecord(program)) collect(program.services);
      });
    });
  }
  return declarations;
}

function provisioningServiceConfig(
  blueprint: BlueprintArtifact,
  provider: ProvisioningProvider,
): ProvisioningServiceConfig {
  const kind = provider === "copilot" ? "copilot-agent" : "foundry-agent";
  const matches = serviceDeclarations(blueprint).filter((service) => service.kind === kind);
  if (matches.length !== 1) {
    throw new Error(
      `Blueprint '${blueprint.payload.id}' must declare exactly one ${kind} service for provisioning`,
    );
  }
  const config = matches[0].config;
  if (!isRecord(config)) throw new Error(`${kind} service config is required for provisioning`);
  const model = String(config.model ?? "").trim();
  if (!model) throw new Error(`${kind} service config.model is required for provisioning`);
  if (provider === "copilot") {
    const workspaceRootId = String(config.workspaceRootId ?? "").trim();
    if (!workspaceRootId) {
      throw new Error("copilot-agent service config.workspaceRootId is required for provisioning");
    }
    return { model, workspaceRootId };
  }
  const projectEndpoint = String(config.projectEndpoint ?? "").trim();
  if (!projectEndpoint) {
    throw new Error("foundry-agent service config.projectEndpoint is required for provisioning");
  }
  const endpoint = new URL(projectEndpoint);
  if (endpoint.protocol !== "https:" || !/^\/api\/projects\/[^/]+\/?$/.test(endpoint.pathname)) {
    throw new Error("foundry-agent config.projectEndpoint must identify an HTTPS /api/projects/<project> resource");
  }
  return { model, projectEndpoint: endpoint.toString().replace(/\/$/, "") };
}

function templateFor(
  blueprint: BlueprintArtifact,
  profile: AgentProvisioningProfile,
): AgentProvisioningTemplate {
  return {
    id: profile.agentId,
    description: profile.description,
    executionAuthority: "host",
    instructions: [
      `Governed Blueprint: ${blueprint.payload.id}@${blueprint.payload.version}.`,
      profile.instructions,
      "Tool calls are proposals; the host validates and executes every operation.",
    ],
    tools: [],
  };
}

function metadata(
  blueprint: BlueprintArtifact,
  profile: AgentProvisioningProfile,
  model: string,
): string {
  return `${JSON.stringify({
    format: "gik-agent-profile/1",
    blueprint: { id: blueprint.payload.id, version: blueprint.payload.version },
    profile: {
      agentId: profile.agentId,
      description: profile.description,
      instructions: profile.instructions,
      model,
    },
  }, null, 2)}\n`;
}

export function generateProvisioningPlan(
  blueprint: BlueprintArtifact,
  rawProfile: AgentProvisioningProfile,
): AgentProvisioningPlan {
  const profile = validateProvisioningProfile(rawProfile, blueprint.payload.id);
  const serviceConfig = provisioningServiceConfig(blueprint, profile.provider);
  const template = templateFor(blueprint, profile);
  const identity = {
    id: blueprint.payload.id,
    version: blueprint.payload.version,
    artifact: blueprint,
  };
  if (profile.provider === "copilot") {
    return {
      format: "gik-project/1",
      provider: "copilot",
      blueprint: identity,
      profile: {
        agentId: profile.agentId,
        workspaceRootId: serviceConfig.workspaceRootId!,
        model: serviceConfig.model,
      },
      files: [
        {
          path: `.github/agents/${profile.agentId}.agent.md`,
          content: toCopilotAgentMarkdown(template, { model: serviceConfig.model }),
        },
        {
          path: `.gik/provisioning/${profile.agentId}.json`,
          content: metadata(blueprint, profile, serviceConfig.model),
        },
      ],
    };
  }
  return {
    format: "gik-project/1",
    provider: "foundry",
    blueprint: identity,
    profile: { agentId: profile.agentId },
    projectEndpoint: serviceConfig.projectEndpoint!,
    agents: [{ id: profile.agentId, definition: toFoundryPromptDefinition(template, serviceConfig.model) }],
  };
}

export function serverPlanInput(plan: AgentProvisioningPlan): Record<string, unknown> {
  return plan.provider === "copilot"
    ? { workspaceRootId: plan.profile.workspaceRootId, files: plan.files }
    : { projectEndpoint: plan.projectEndpoint, agents: plan.agents };
}
