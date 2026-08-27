import { handleLoreTool } from './handlers/lore.js';
import { handleRemoteMcpTool } from './handlers/mcp-proxy.js';
import { handleCopilotTool } from './handlers/copilot.js';
import { handleFilesystemTool } from './handlers/filesystem.js';
import { handleGikAgentTool } from './handlers/gik-agent.js';

const HANDLERS = {
  'filesystem': handleFilesystemTool,
  'lore': handleLoreTool,
  'copilot': handleCopilotTool,
  'gik.agent': handleGikAgentTool,
  'mcp.proxy': handleRemoteMcpTool,
};

export function resolveHandler(handlerId) {
  const handler = HANDLERS[handlerId];
  if (!handler) {
    throw new Error(`Unknown MCP handler: ${handlerId}`);
  }
  return handler;
}
