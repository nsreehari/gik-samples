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
  model: string;
  workspaceRootId: string;
}

export interface CopilotProvisioningPlan {
  format: "gik-project/1";
  provider: "copilot";
  blueprint: { id: string; version: string; artifact: BlueprintArtifact };
  profile: { agentId: string; workspaceRootId: string };
  files: Array<{ path: string; content: string }>;
}

export interface FoundryProvisioningPlan {
  format: "gik-project/1";
  provider: "foundry";
  blueprint: { id: string; version: string; artifact: BlueprintArtifact };
  profile: { agentId: string };
  agents: Array<{ id: string; definition: ReturnType<typeof toFoundryPromptDefinition> }>;
}

export type AgentProvisioningPlan = CopilotProvisioningPlan | FoundryProvisioningPlan;

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
    model: "gpt-5.4",
    workspaceRootId: "workspace",
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
  const model = profile.model.trim();
  const workspaceRootId = profile.workspaceRootId.trim();
  if (!description) throw new Error("Description is required");
  if (!instructions) throw new Error("Instructions are required");
  if (!model) throw new Error("Model is required");
  if (!workspaceRootId) throw new Error("Workspace root ID is required");
  return { ...profile, agentId, description, instructions, model, workspaceRootId };
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
): string {
  return `${JSON.stringify({
    format: "gik-agent-profile/1",
    blueprint: { id: blueprint.payload.id, version: blueprint.payload.version },
    profile: {
      agentId: profile.agentId,
      description: profile.description,
      instructions: profile.instructions,
      model: profile.model,
    },
  }, null, 2)}\n`;
}

export function generateProvisioningPlan(
  blueprint: BlueprintArtifact,
  rawProfile: AgentProvisioningProfile,
): AgentProvisioningPlan {
  const profile = validateProvisioningProfile(rawProfile, blueprint.payload.id);
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
      profile: { agentId: profile.agentId, workspaceRootId: profile.workspaceRootId },
      files: [
        {
          path: `.github/agents/${profile.agentId}.agent.md`,
          content: toCopilotAgentMarkdown(template, { model: profile.model }),
        },
        {
          path: `.gik/provisioning/${profile.agentId}.json`,
          content: metadata(blueprint, profile),
        },
      ],
    };
  }
  return {
    format: "gik-project/1",
    provider: "foundry",
    blueprint: identity,
    profile: { agentId: profile.agentId },
    agents: [{ id: profile.agentId, definition: toFoundryPromptDefinition(template, profile.model) }],
  };
}

export function serverPlanInput(plan: AgentProvisioningPlan): Record<string, unknown> {
  return plan.provider === "copilot"
    ? { workspaceRootId: plan.profile.workspaceRootId, files: plan.files }
    : { agents: plan.agents };
}
