import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createFinbookHttpServer } from "../src/index.js";

async function post(serverUrl, payload, sessionId) {
  const response = await fetch(`${serverUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:5176",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test("serves the Finbook tool catalog and seeded accounts", async (t) => {
  const server = createFinbookHttpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const address = server.address();
  assert(address && typeof address === "object");
  const serverUrl = `http://127.0.0.1:${address.port}`;
  const initialized = await post(serverUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    },
  });
  const sessionId = initialized.response.headers.get("mcp-session-id");
  assert(sessionId);
  assert.equal(initialized.response.headers.get("access-control-expose-headers"), "mcp-session-id");

  const notification = await post(serverUrl, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  }, sessionId);
  assert.equal(notification.response.status, 204);
  assert.equal(notification.body, null);

  const catalog = await post(serverUrl, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  }, sessionId);
  assert.equal(catalog.body.result.tools.length, 23);

  const accounts = await post(serverUrl, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "finbook.list_accounts",
      arguments: {},
    },
  }, sessionId);
  assert.deepEqual(
    accounts.body.result.structuredContent.data.accounts.map(({ account }) => account),
    ["Asha", "Ravi"],
  );
});
