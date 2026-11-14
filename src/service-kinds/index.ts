import {
  createContextStoreServiceKind,
  ServiceKindRegistry,
  type ServiceKindFactory,
} from "gik-controlface/services";
import { createFoundryServiceKind } from "gik-service-providers/foundry";

import { copilotAgentKind } from "./copilot-agent";
import { createDeterministicAgentKind, type DeterministicServiceHandler } from "./deterministic-agent";
import { createDurableStorageKind, type DurableStorageConnection } from "./durable-storage";
import {
  closeAgentResponseWorkspace,
  openAgentResponseWorkspace,
  parseAgentResponseWorkspaceSpec,
  readAgentResponseProposal,
} from "./agent-response-workspace";
import { httpServiceKind } from "./http-service";
import { mcpServiceKind } from "./mcp";

export interface SampleServiceRegistryOptions {
  hostCapabilities?: Iterable<string>;
  deterministicHandlers?: Record<string, DeterministicServiceHandler>;
  durableStorageConnections?: Readonly<Record<string, DurableStorageConnection>>;
  resolveCredential?: (reference: string) => Promise<unknown>;
  clearCredential?: (reference: string) => void | Promise<void>;
  authorizeEndpoint?: (kind: string, endpoint: URL) => boolean | Promise<boolean>;
  execute?: (request: unknown) => Promise<unknown>;
}

export function createSampleServiceKindRegistry(
  options: SampleServiceRegistryOptions = {}
): ServiceKindRegistry {
  const registry = new ServiceKindRegistry(options);
  const factories: ServiceKindFactory[] = [
    createDeterministicAgentKind(options.deterministicHandlers ?? {}),
    createDurableStorageKind(options.durableStorageConnections ?? {}),
    createContextStoreServiceKind(),
    createFoundryServiceKind({
      openResponseWorkspace: (requestId, value) => {
        const spec = parseAgentResponseWorkspaceSpec(value);
        if (!spec) throw new Error("Foundry authoringWorkspace must declare a response workspace");
        openAgentResponseWorkspace(requestId, spec);
        return {
          readProposal: () => readAgentResponseProposal(requestId),
          close: () => closeAgentResponseWorkspace(requestId),
        };
      },
    }),
    copilotAgentKind,
    mcpServiceKind,
    httpServiceKind,
  ];
  for (const factory of factories) {
    registry.register(factory);
  }
  return registry;
}

export * from "./deterministic-agent";
export * from "./durable-storage";
