#!/usr/bin/env node

import { JsonSchemaMcpServer } from '../../src/json-schema-server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import fs from 'node:fs';

const server = new JsonSchemaMcpServer({
  name: 'mock-upstream',
  version: '1.0.0',
});

server.registerTool(
  'upstream.echo',
  {
    title: 'Upstream Echo',
    description: 'Echo arguments from the mock upstream MCP server.',
    inputSchema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: { type: 'string', description: 'Message to echo.' },
        count: { type: 'integer' },
        mode: { anyOf: [{ type: 'string', const: 'brief' }, { type: 'string', const: 'full' }] },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
  },
  async (args) => ({
    content: [
      {
        type: 'text',
        text: `upstream:${args.message}`,
      },
    ],
    structuredContent: {
      received: args,
      source: 'mock-upstream',
    },
  }),
);

if (process.env.MOCK_UPSTREAM_EXTRA_TOOL_FILE && fs.existsSync(process.env.MOCK_UPSTREAM_EXTRA_TOOL_FILE)) {
  server.registerTool(
    'upstream.extra',
    {
      title: 'Upstream Extra',
      description: 'A tool added after proxy startup.',
      inputSchema: { type: 'object', properties: {} },
    },
    async () => ({ content: [{ type: 'text', text: 'extra-ready' }] }),
  );
}

await server.connect(new StdioServerTransport());