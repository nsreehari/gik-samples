import { ServiceKindRegistry, type ServiceKindFactory, type ServiceKindManifest } from "@gik-ai/controlface/services";

import { createWorkerServiceKind } from "./worker-service-kind";
import { executeMcpServiceInvocation } from "./mcp-runtime";

const mcpManifest: ServiceKindManifest = {
  id: "mcp",
  version: "1",
  title: "Model Context Protocol",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      server: { type: "string", minLength: 1 },
      tool: { type: "string", minLength: 1 },
    },
    required: ["server", "tool"],
  },
  executionModes: ["immediate", "queued"],
  subjects: ["cell"],
  requiresHostCapabilities: ["mcp-executor"],
  supports: { cancel: false, probe: true },
};

const mcpServiceKind: ServiceKindFactory = createWorkerServiceKind(mcpManifest);

export function createFinbookServiceRegistry(serverOverride?: string): ServiceKindRegistry {
  const registry = new ServiceKindRegistry({
    hostCapabilities: ["mcp-executor"],
    execute: async (request) => {
      const invocation = request as Parameters<typeof executeMcpServiceInvocation>[0];
      const config = invocation.declaration.config;
      return executeMcpServiceInvocation(serverOverride
        ? {
            ...invocation,
            declaration: {
              ...invocation.declaration,
              config: {
                ...(config && typeof config === "object" && !Array.isArray(config) ? config : {}),
                server: serverOverride,
              },
            },
          }
        : invocation);
    },
  });
  registry.register(mcpServiceKind);
  return registry;
}
