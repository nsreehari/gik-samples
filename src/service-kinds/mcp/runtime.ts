import type { Json } from "@gik-ai/kernel";

export interface McpClientInfo {
  name: string;
  version: string;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpHttpClient {
  listTools(signal?: AbortSignal): Promise<McpToolDescriptor[]>;
  callTool(name: string, input: Json, signal?: AbortSignal): Promise<Json>;
}

interface McpSession {
  id?: string;
  protocolVersion: string;
}

interface McpHttpClientOptions {
  server: URL;
  clientInfo: McpClientInfo;
  fetchImpl: typeof globalThis.fetch;
}

class McpHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "McpHttpError";
  }
}

function streamableHeaders(
  sessionId?: string,
  protocolVersion?: string,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    ...(protocolVersion ? { "MCP-Protocol-Version": protocolVersion } : {}),
  };
}

function parseStreamablePayload(
  text: string,
  expectedId: string,
): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{")) {
    const payload = JSON.parse(trimmed) as Record<string, unknown>;
    if (payload.id !== expectedId) {
      throw new Error(`MCP response id did not match request '${expectedId}'`);
    }
    return payload;
  }

  for (const event of trimmed.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n")
      .trim();
    if (!data) continue;
    const payload = JSON.parse(data) as Record<string, unknown>;
    if (payload.id === expectedId) return payload;
  }
  throw new Error(`MCP response did not contain JSON-RPC id '${expectedId}'`);
}

async function readRpcPayload(
  response: Response,
  expectedId: string,
): Promise<Record<string, unknown>> {
  return parseStreamablePayload(await response.text(), expectedId);
}

function rpcError(payload: Record<string, unknown>, fallback: string): Error | undefined {
  if (!payload.error || typeof payload.error !== "object") return undefined;
  return new Error(String((payload.error as Record<string, unknown>).message ?? fallback));
}

function extractText(result: Record<string, unknown>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content
    .filter((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).type === "text")
    .map((entry) => String((entry as Record<string, unknown>).text ?? ""))
    .join("\n")
    .trim();
}

function asInputSchema(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createMcpHttpClient(options: McpHttpClientOptions): McpHttpClient {
  let session: Promise<McpSession> | undefined;
  let requestId = 0;

  const nextId = (method: string) => `${method}:${++requestId}`;

  const initialize = async (): Promise<McpSession> => {
    const initializeId = nextId("initialize");
    const response = await options.fetchImpl(options.server, {
      method: "POST",
      headers: streamableHeaders(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: initializeId,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: options.clientInfo,
        },
      }),
    });
    if (!response.ok) {
      throw new McpHttpError(`MCP initialize failed (${response.status})`, response.status);
    }

    const id = response.headers.get("mcp-session-id")?.trim() || undefined;
    const payload = await readRpcPayload(response, initializeId);
    const error = rpcError(payload, "MCP initialize failed");
    if (error) throw error;
    const result = payload.result && typeof payload.result === "object"
      ? payload.result as Record<string, unknown>
      : {};
    const protocolVersion = String(result.protocolVersion ?? "2025-06-18");

    const initialized = await options.fetchImpl(options.server, {
      method: "POST",
      headers: streamableHeaders(id, protocolVersion),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    if (!initialized.ok) {
      throw new McpHttpError(
        `MCP initialized notification failed (${initialized.status})`,
        initialized.status,
      );
    }
    return { id, protocolVersion };
  };

  const getSession = (): Promise<McpSession> => {
    if (session) return session;
    session = initialize().catch((error) => {
      session = undefined;
      throw error;
    });
    return session;
  };

  const request = async (
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    retry = true,
  ): Promise<Record<string, unknown>> => {
    const activeSession = await getSession();
    const id = nextId(method);
    const response = await options.fetchImpl(options.server, {
      method: "POST",
      headers: streamableHeaders(activeSession.id, activeSession.protocolVersion),
      signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
    });

    if (response.status === 404 && activeSession.id && retry) {
      session = undefined;
      return request(method, params, signal, false);
    }
    if (!response.ok) {
      throw new McpHttpError(`MCP request failed (${response.status})`, response.status);
    }

    const payload = await readRpcPayload(response, id);
    const error = rpcError(payload, "MCP request failed");
    if (error) throw error;
    return payload.result && typeof payload.result === "object"
      ? payload.result as Record<string, unknown>
      : {};
  };

  return {
    listTools: async (signal) => {
      const result = await request("tools/list", {}, signal);
      const tools = Array.isArray(result.tools) ? result.tools : [];
      return tools.flatMap((tool): McpToolDescriptor[] => {
        if (!tool || typeof tool !== "object") return [];
        const descriptor = tool as Record<string, unknown>;
        const name = String(descriptor.name ?? "").trim();
        if (!name) return [];
        const description = typeof descriptor.description === "string"
          ? descriptor.description
          : undefined;
        return [{
          name,
          ...(description ? { description } : {}),
          inputSchema: asInputSchema(descriptor.inputSchema),
        }];
      });
    },
    callTool: async (name, input, signal) => {
      const result = await request("tools/call", {
        name,
        arguments: input ?? {},
      }, signal);
      const text = extractText(result);
      if (result.isError === true) {
        throw new Error(text || "MCP tool reported an error");
      }
      return {
        text,
        structured: result.structuredContent && typeof result.structuredContent === "object"
          ? result.structuredContent as Json
          : {},
      };
    },
  };
}
