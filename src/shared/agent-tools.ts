import {
  createCapabilityDescribeTool,
  type AgentTool,
  type AgentToolExecutionContext,
} from "gik-agent-lifecycle-exp";
import type { AgentFacingCapabilityCatalog, ProjectionProvider } from "gik-components";
import { createAgentResponseTools } from "../service-kinds/agent-response-workspace";
import { sampleAgentToolContracts } from "./agent-tool-contracts";

interface ScopedDescribeTool extends AgentTool {
  scopeToCapabilities?: (acceptedCapabilities: readonly string[] | undefined) => Promise<AgentTool>;
}

function selectCatalogCapabilities(
  catalog: AgentFacingCapabilityCatalog,
  capabilities: readonly string[],
): AgentFacingCapabilityCatalog {
  const selected = new Set(capabilities);
  return {
    catalog: Object.fromEntries(
      Object.entries(catalog.catalog).filter(([capability]) => selected.has(capability)),
    ),
    details: Object.fromEntries(
      Object.entries(catalog.details).filter(([capability]) => selected.has(capability)),
    ),
  };
}

export function createSampleAgentTools(
  providers: readonly ProjectionProvider[] = [],
): readonly AgentTool[] {
  // The package catalog is large and only matters once an agent actually calls `describe`. Defer
  // loading provider-set authoring metadata until the tool is first invoked.
  let providerSetPromise: Promise<ProjectionProviderSet> | undefined;
  const resolveProviderSet = (): Promise<ProjectionProviderSet> => {
    providerSetPromise ??= import("gik-components").then(
      ({ createProjectionProviderSet }) => createProjectionProviderSet(providers),
    );
    return providerSetPromise;
  };
  const resolveDescribeTool = async (acceptedCapabilities?: readonly string[]): Promise<AgentTool> => {
    const providerSet = await resolveProviderSet();
    if (acceptedCapabilities === undefined) {
      return createCapabilityDescribeTool(providerSet.agentFacingCatalog());
    }
    const knownCapabilities = new Set(
      Object.values(providerSet.definitions()).map((definition) => definition.capability),
    );
    const scopedCapabilities = acceptedCapabilities.filter((capability) => knownCapabilities.has(capability));
    const kit = providerSet.getKit(scopedCapabilities);
    return createCapabilityDescribeTool(
      selectCatalogCapabilities(providerSet.agentFacingCatalog(), kit.capabilities),
    );
  };

  type ProjectionProviderSet = Awaited<ReturnType<typeof import("gik-components")["createProjectionProviderSet"]>>;

  const describeTool: ScopedDescribeTool = {
    name: "describe",
    ...sampleAgentToolContracts.describe,
    lifecycle: "agent",
    handler: async (args: unknown, context?: AgentToolExecutionContext) =>
      (await resolveDescribeTool()).handler(args, context),
    scopeToCapabilities: (acceptedCapabilities) => resolveDescribeTool(acceptedCapabilities),
  };

  return [
    describeTool,
    ...createAgentResponseTools(),
  ];
}
