import type { NativeServiceDeclaration } from "@gik-ai/kernel";
import {
  serviceConfig,
  type ServiceAdapter,
  type ServiceKindFactory,
  type ServiceKindManifest,
} from "@gik-ai/controlface/services";

import { createMcpHttpClient } from "./mcp-client";

const manifest: ServiceKindManifest = {
  id: "mcp",
  version: "1",
  title: "Model Context Protocol",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      server: { type: "string", minLength: 1 },
    },
    required: ["server"],
  },
  executionModes: ["immediate", "queued"],
  subjects: ["cell"],
  requiresHostCapabilities: ["mcp-executor"],
  supports: {
    discover: true,
    probe: true,
    cancel: false,
  },
};

function serverUrl(declaration: NativeServiceDeclaration): URL {
  const server = String(serviceConfig(declaration).server ?? "").trim();
  if (!server) throw new Error("MCP service requires config.server");
  const url = new URL(server);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`MCP service server must use HTTP or HTTPS, received '${url.protocol}'`);
  }
  return url;
}

export function createMcpServiceKind(): ServiceKindFactory {
  return {
    manifest,
    validate: async (declaration, context) => {
      let endpoint: URL;
      try {
        endpoint = serverUrl(declaration);
      } catch (error) {
        return {
          ok: false,
          errors: [error instanceof Error ? error.message : String(error)],
        };
      }
      if (context.authorizeEndpoint
        && !await context.authorizeEndpoint(manifest.id, endpoint)) {
        return {
          ok: false,
          errors: [`MCP endpoint '${endpoint.href}' is not authorized by the host`],
        };
      }
      return { ok: true };
    },
    create: async (declaration, context): Promise<ServiceAdapter> => {
      const endpoint = serverUrl(declaration);
      if (context.authorizeEndpoint
        && !await context.authorizeEndpoint(manifest.id, endpoint)) {
        throw new Error(`MCP endpoint '${endpoint.href}' is not authorized by the host`);
      }

      const operations = new Set(
        Object.values(declaration.operations).map(({ operation }) => operation),
      );
      const client = createMcpHttpClient(endpoint);
      const provider = {
        id: `mcp:${context.identity?.serviceId ?? endpoint.href}`,
        version: manifest.version,
        title: manifest.title,
      };

      return {
        provider,
        discover: async () => {
          const tools = await client.listTools();
          const discovered = new Map(tools.map((tool) => [tool.name, tool]));
          const missing = [...operations].filter((operation) => !discovered.has(operation));
          return {
            provider,
            revision: manifest.version,
            discoveredAt: new Date().toISOString(),
            capabilities: [...operations].map((operation) => {
              const tool = discovered.get(operation);
              return {
                id: operation,
                operation,
                version: declaration.version,
                ...(tool?.description ? { description: tool.description } : {}),
                inputSchema: tool?.inputSchema ?? {},
                assurance: tool ? "provider-discovered" : "declared-and-locally-validated",
                supports: {
                  validate: true,
                  cancel: false,
                },
              };
            }),
            ...(missing.length > 0
              ? { warnings: [`MCP server did not advertise declared tools: ${missing.join(", ")}`] }
              : {}),
          };
        },
        validate: (request) => operations.has(request.operation)
          ? { ok: true }
          : {
              ok: false,
              errors: [`MCP tool '${request.operation}' is not declared by this Blueprint service`],
            },
        probe: async () => {
          const tools = await client.listTools();
          return {
            ok: true,
            detail: { toolCount: tools.length },
          };
        },
        execute: async (request) => ({
          output: await client.callTool(request.operation, request.input ?? {}),
        }),
      };
    },
  };
}
