import { ServiceKindRegistry } from "@gik-ai/controlface/services";

import { createMcpServiceKind } from "./mcp-service-kind";

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

export function createFinbookServiceRegistry(): ServiceKindRegistry {
  const registry = new ServiceKindRegistry({
    hostCapabilities: ["mcp-executor"],
    authorizeEndpoint: (kind, endpoint) => kind === "mcp"
      && (endpoint.protocol === "https:"
        || (endpoint.protocol === "http:" && isLoopback(endpoint.hostname))),
  });
  registry.register(createMcpServiceKind());
  return registry;
}
