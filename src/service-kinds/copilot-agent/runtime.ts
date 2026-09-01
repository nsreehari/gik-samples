import type { Json } from "@gik-ai/kernel";
import { serviceConfig } from "@gik-ai/controlface/services";
import type { WorkerServiceInvocation } from "../worker-service-kind";
import { createMcpHttpClient } from "../mcp/runtime";
import { parseAgentJsonReply } from "../agent-json-response";

type McpResult = {
  text?: Json;
  structured?: Json;
};

const DEFAULT_COPILOT_TIMEOUT_MS = 120_000;

export async function executeCopilotAgentInvocation(
  request: WorkerServiceInvocation,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): Promise<Json> {
  const config = serviceConfig(request.declaration);
  const input = request.input && typeof request.input === "object" && !Array.isArray(request.input)
    ? request.input as Record<string, Json>
    : {};
  const server = String(config.server ?? "").trim();
  if (!server) throw new Error("copilot-agent requires an MCP server");
  const client = createMcpHttpClient({
    server: new URL(server),
    clientInfo: {
      name: "@gik-ai/samples-copilot-agent",
      version: "0.1.0",
    },
    fetchImpl,
  });
  const cwd = String(input.workspaceRef ?? config.workspaceRef ?? ".");

  if (request.operation === "discover") {
    const result = await client.callTool("copilot.list_agents", { cwd }) as McpResult;
    const structured = result.structured && typeof result.structured === "object" && !Array.isArray(result.structured)
      ? result.structured as Record<string, Json>
      : {};
    const agents = Array.isArray(structured.agents) ? structured.agents : [];
    return agents
      .map((agent) => agent && typeof agent === "object" && !Array.isArray(agent)
        ? String((agent as Record<string, Json>).id ?? "").trim()
        : "")
      .filter(Boolean);
  }

  if (request.operation === "chat") {
    const instructions = String(input.instructions ?? "").trim();
    const message = String(input.message ?? "").trim();
    const timeoutMs = typeof config.timeoutMs === "number"
      ? config.timeoutMs
      : DEFAULT_COPILOT_TIMEOUT_MS;
    const additionalMcpConfig = JSON.stringify({
      mcpServers: {
        "gik-agent-authoring": {
          type: "http",
          url: String(config.server ?? ""),
          tools: ["describe"],
        },
      },
    });
    const result = await client.callTool(
      "copilot.run_agent",
      {
        message: instructions ? `${message}\n\n${instructions}` : message,
        agent: String(input.agentName ?? config.agent ?? ""),
        cwd,
        model: String(input.model ?? config.model ?? ""),
        runMode: "sync",
        timeoutMs,
        additionalMcpConfigs: [additionalMcpConfig],
      },
    ) as McpResult;
    const structured = result.structured && typeof result.structured === "object" && !Array.isArray(result.structured)
      ? result.structured as Record<string, Json>
      : {};
    const reply = String(structured.stdout ?? result.text ?? "");
    if (config.responseMode === "json") {
      return parseAgentJsonReply("copilot-agent", reply);
    }
    return {
      reply,
      conversationId: String(structured.sessionId ?? input.conversationId ?? ""),
      responseId: String(structured.sessionId ?? request.correlationId ?? "copilot-run"),
    };
  }

  throw new Error(`Unsupported copilot-agent operation '${request.operation}'`);
}