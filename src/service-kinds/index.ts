import { ServiceKindRegistry, type ServiceKindFactory } from "gik-controlface/services";

import { copilotAgentKind } from "./copilot-agent";
import { createDeterministicAgentKind, type DeterministicServiceHandler } from "./deterministic-agent";
import { createDurableStorageKind, type DurableStorageConnection } from "./durable-storage";
import { foundryAgentKind } from "./foundry-agent";
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
    foundryAgentKind,
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
