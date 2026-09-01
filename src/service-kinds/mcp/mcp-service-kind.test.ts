import assert from "node:assert/strict";
import { test } from "vitest";

import type { Json, NativeServiceDeclaration } from "@gik-ai/kernel";
import { ServiceKindRegistry } from "@gik-ai/controlface/services";

import { createMcpServiceKind } from ".";
import { createMcpHttpClient } from "./runtime";

const declaration: NativeServiceDeclaration = {
  kind: "mcp",
  version: "2",
  config: {
    server: "https://mcp.example.test/rpc",
  },
  scope: "per-blueprint",
  operations: {
    load: {
      operation: "records.load",
      contract: "records/v1",
    },
  },
};

function rpcResponse(
  result: Record<string, unknown>,
  id: unknown,
  sessionId?: string,
): Response {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id,
    result,
  }), {
    status: 200,
    headers: sessionId ? { "Mcp-Session-Id": sessionId } : undefined,
  });
}

test("MCP service kind maps the Blueprint provider operation to tools/call", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push(body);
    if (body.method === "initialize") {
      return rpcResponse({ protocolVersion: "2025-06-18" }, body.id, "session-1");
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 204 });
    if (body.method === "tools/list") {
      return rpcResponse({
        tools: [{
          name: "records.load",
          description: "Load records",
          inputSchema: { type: "object" },
        }],
      }, body.id);
    }
    if (body.method === "tools/call") {
      return rpcResponse({
        structuredContent: { records: [1, 2] },
        content: [{ type: "text", text: "Loaded" }],
      }, body.id);
    }
    return new Response(null, { status: 500 });
  };
  const registry = new ServiceKindRegistry({
    hostCapabilities: ["mcp-executor"],
    authorizeEndpoint: (_kind, endpoint) => endpoint.origin === "https://mcp.example.test",
  });
  registry.register(createMcpServiceKind({ fetch: fetchImpl }));

  const adapter = await registry.materialize({
    blueprintId: "test",
    blueprintRevision: "1",
    serviceId: "records",
  }, declaration);
  const catalog = await adapter.discover();
  assert.equal(catalog.capabilities[0]?.operation, "records.load");

  const execution = await adapter.execute({
    id: "request-1",
    providerId: adapter.provider.id,
    capabilityId: "records.load",
    createdAt: new Date(0).toISOString(),
    service: "records",
    operation: "records.load",
    input: { id: 7 },
  }, {});
  assert.deepEqual(execution.output, {
    text: "Loaded",
    structured: { records: [1, 2] },
  } satisfies Record<string, Json>);

  const toolCall = calls.find((call) => call.method === "tools/call");
  assert.deepEqual(toolCall?.params, {
    name: "records.load",
    arguments: { id: 7 },
  });
  assert.equal(calls.filter((call) => call.method === "initialize").length, 1);
  assert.equal(calls.filter((call) => call.method === "notifications/initialized").length, 1);
});

test("MCP service kind rejects host-denied endpoints and deprecated tool config", async () => {
  const registry = new ServiceKindRegistry({
    hostCapabilities: ["mcp-executor"],
    authorizeEndpoint: () => false,
  });
  registry.register(createMcpServiceKind());

  const denied = await registry.validate(declaration);
  assert.equal(denied.ok, false);
  assert.match(denied.errors?.[0] ?? "", /not authorized/);

  const legacy = await registry.validate({
    ...declaration,
    config: {
      server: "https://mcp.example.test/rpc",
      tool: "records.load",
    },
  });
  assert.equal(legacy.ok, false);
  assert.match(legacy.errors?.join("; ") ?? "", /additional properties/);
});

test("MCP client supports stateless servers and selects the matching SSE response", async () => {
  const requestHeaders: Headers[] = [];
  const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requestHeaders.push(new Headers(init?.headers));
    if (body.method === "initialize") {
      return rpcResponse({ protocolVersion: "2025-06-18" }, body.id);
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 204 });
    if (body.method === "tools/list") {
      return new Response([
        "event: message",
        "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}",
        "",
        "event: message",
        `data: ${JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [{ name: "records.load", inputSchema: {} }] },
        })}`,
        "",
      ].join("\n"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response(null, { status: 500 });
  };
  const client = createMcpHttpClient({
    server: new URL("https://mcp.example.test/rpc"),
    clientInfo: { name: "test", version: "1" },
    fetchImpl,
  });

  assert.deepEqual(await client.listTools(), [{
    name: "records.load",
    inputSchema: {},
  }]);
  assert.equal(requestHeaders[0]?.has("Mcp-Session-Id"), false);
  assert.equal(requestHeaders[1]?.get("MCP-Protocol-Version"), "2025-06-18");
  assert.equal(requestHeaders[2]?.get("MCP-Protocol-Version"), "2025-06-18");
});

test("MCP client reinitializes an expired stateful session on 404", async () => {
  let initializations = 0;
  let toolCalls = 0;
  const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (body.method === "initialize") {
      initializations += 1;
      return rpcResponse(
        { protocolVersion: "2025-06-18" },
        body.id,
        `session-${initializations}`,
      );
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 204 });
    if (body.method === "tools/list") {
      toolCalls += 1;
      if (toolCalls === 1) return new Response(null, { status: 404 });
      return rpcResponse({ tools: [] }, body.id);
    }
    return new Response(null, { status: 500 });
  };
  const client = createMcpHttpClient({
    server: new URL("https://mcp.example.test/rpc"),
    clientInfo: { name: "test", version: "1" },
    fetchImpl,
  });

  assert.deepEqual(await client.listTools(), []);
  assert.equal(initializations, 2);
  assert.equal(toolCalls, 2);
});
