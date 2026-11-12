import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { JsonSchemaMcpServer } from '../src/json-schema-server.js';

async function connect(t, register) {
  const server = new JsonSchemaMcpServer({ name: 'json-schema-test', version: '1.0.0' });
  register(server);
  const client = new Client({ name: 'json-schema-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

test('JSON Schema tools preserve declarations and enforce required, union, and additional-property constraints', async (t) => {
  const inputSchema = {
    type: 'object',
    required: ['value'],
    additionalProperties: false,
    properties: {
      value: { anyOf: [{ type: 'integer', minimum: 2 }, { type: 'string', pattern: '^ok-' }] },
    },
  };
  const calls = [];
  const { client } = await connect(t, (server) => server.registerTool(
    'echo',
    { inputSchema },
    async (args) => {
      calls.push(args);
      return { content: [{ type: 'text', text: JSON.stringify(args) }], structuredContent: args };
    },
  ));
  assert.deepEqual((await client.listTools()).tools[0].inputSchema, inputSchema);
  for (const args of [{}, { value: 1 }, { value: 'bad' }, { value: 3, extra: true }]) {
    const result = await client.callTool({ name: 'echo', arguments: args });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Invalid arguments/);
  }
  for (const args of [{ value: 3 }, { value: 'ok-value' }]) {
    assert.deepEqual((await client.callTool({ name: 'echo', arguments: args })).structuredContent, args);
  }
  assert.deepEqual(calls, [{ value: 3 }, { value: 'ok-value' }]);
});

test('JSON Schema tools reject invalid or missing structured output and preserve explicit tool errors', async (t) => {
  const outputSchema = {
    type: 'object', required: ['count'],
    properties: { count: { type: 'integer', minimum: 1 } },
  };
  const { client } = await connect(t, (server) => {
    for (const [name, result] of Object.entries({
      invalid: { content: [], structuredContent: { count: 0 } },
      missing: { content: [] },
      failed: { isError: true, content: [{ type: 'text', text: 'Expected failure' }] },
      valid: { content: [], structuredContent: { count: 2 } },
    })) {
      server.registerTool(name, { outputSchema }, async () => result);
    }
  });
  assert.equal((await client.callTool({ name: 'invalid' })).isError, true);
  assert.equal((await client.callTool({ name: 'missing' })).isError, true);
  assert.equal((await client.callTool({ name: 'failed' })).content[0].text, 'Expected failure');
  assert.deepEqual((await client.callTool({ name: 'valid' })).structuredContent, { count: 2 });
});
