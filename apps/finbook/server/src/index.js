import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { handleFinbookTool } from "../finbook-handler.js";

const serverDirectory = fileURLToPath(new URL("../", import.meta.url));
const manifestPath = fileURLToPath(new URL("../domain/mcp-executable-manifest.json", import.meta.url));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const tools = new Map(manifest.tools.map((tool) => [tool.name, {
  ...tool,
  manifestPath,
  config: {
    repoPath: ".",
    ...(process.env.FINBOOK_DB_PATH ? { dbPath: process.env.FINBOOK_DB_PATH } : {}),
  },
}]));
const sessions = new Set();

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function corsHeaders(origin) {
  const allowedOrigins = (process.env.FINBOOK_ALLOWED_ORIGINS ?? "http://localhost:5176,http://127.0.0.1:5176")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!origin || !allowedOrigins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type,mcp-session-id",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Expose-Headers": "mcp-session-id",
    Vary: "Origin",
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleRpc(request, response) {
  const origin = request.headers.origin;
  const cors = corsHeaders(origin);
  if (origin && !cors["Access-Control-Allow-Origin"]) {
    json(response, 403, rpcError(null, -32000, "Origin is not allowed"));
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, cors);
    response.end();
    return;
  }
  if (request.method !== "POST") {
    json(response, 405, rpcError(null, -32600, "Only POST is supported"), cors);
    return;
  }

  let body;
  try {
    body = await readBody(request);
  } catch {
    json(response, 400, rpcError(null, -32700, "Invalid JSON"), cors);
    return;
  }

  if (body.method === "initialize") {
    const sessionId = randomUUID();
    sessions.add(sessionId);
    json(response, 200, rpcResult(body.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "finbook", version: "0.1.0" },
    }), { ...cors, "Mcp-Session-Id": sessionId });
    return;
  }

  const sessionId = String(request.headers["mcp-session-id"] ?? "");
  if (!sessions.has(sessionId)) {
    json(response, 400, rpcError(body.id ?? null, -32001, "Invalid MCP session"), cors);
    return;
  }

  if (body.method === "notifications/initialized" && body.id === undefined) {
    response.writeHead(204, cors);
    response.end();
    return;
  }

  if (body.method === "tools/list") {
    json(response, 200, rpcResult(body.id, {
      tools: [...tools.values()].map(({ name, title, description, inputSchema }) => ({
        name,
        title,
        description,
        inputSchema,
      })),
    }), cors);
    return;
  }

  if (body.method === "tools/call") {
    const tool = tools.get(body.params?.name);
    if (!tool) {
      json(response, 200, rpcError(body.id, -32601, `Unknown Finbook tool: ${body.params?.name}`), cors);
      return;
    }
    try {
      json(response, 200, rpcResult(body.id, await handleFinbookTool(body.params?.arguments ?? {}, tool)), cors);
    } catch (error) {
      json(response, 200, rpcError(body.id, -32000, error instanceof Error ? error.message : String(error)), cors);
    }
    return;
  }

  json(response, 200, rpcError(body.id ?? null, -32601, `Unsupported method: ${body.method}`), cors);
}

export function createFinbookHttpServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      json(response, 200, { ok: true, service: "finbook" });
      return;
    }
    if (url.pathname !== "/mcp") {
      json(response, 404, { error: "Not found" });
      return;
    }
    void handleRpc(request, response);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = process.env.FINBOOK_HOST ?? "127.0.0.1";
  const port = Number(process.env.FINBOOK_PORT ?? 7811);
  createFinbookHttpServer().listen(port, host, () => {
    process.stdout.write(`Finbook MCP listening on http://${host}:${port}/mcp\n`);
  });
}
