import {
  createCapabilityDescribeTool,
  type AgentTool,
  type AgentToolExecutionContext,
} from "@gik-ai/agent-lifecycle-exp";
import type { AgentFacingCapabilityCatalog } from "@gik-ai/components/agent-facing";
import { createAgentResponseTools } from "../service-kinds/agent-response-workspace";
import { sampleAgentToolContracts } from "./agent-tool-contracts";

export function createSampleAgentTools(
  extensions: readonly AgentFacingCapabilityCatalog[] = [],
): readonly AgentTool[] {
  // `@gik-ai/components/agent-facing` carries generated per-component capability metadata (~470KB) that
  // only matters once an agent actually calls `describe`. Loading it eagerly here pulls that weight
  // into every Blueprint's service host at render time, even for purely human-facing sessions. Defer
  // the import (and the catalog merge/tool construction it feeds) until the tool is first invoked.
  let describeToolPromise: Promise<AgentTool> | undefined;
  const resolveDescribeTool = (): Promise<AgentTool> => {
    describeToolPromise ??= import("@gik-ai/components/agent-facing").then(
      ({ agentFacingComponentCatalog, mergeAgentFacingCapabilityCatalogs }) =>
        createCapabilityDescribeTool(
          mergeAgentFacingCapabilityCatalogs(agentFacingComponentCatalog, ...extensions),
        ),
    );
    return describeToolPromise;
  };

  return [
    {
      name: "describe",
      ...sampleAgentToolContracts.describe,
      lifecycle: "agent",
      handler: async (args: unknown, context?: AgentToolExecutionContext) =>
        (await resolveDescribeTool()).handler(args, context),
    },
    ...createAgentResponseTools(),
  ];
}
