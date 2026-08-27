import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const MCP_SERVER_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export const MCP_SERVER_ENV_PATH = path.join(MCP_SERVER_DIRECTORY, '.env');

export function loadMcpServerEnv(envPath = MCP_SERVER_ENV_PATH) {
  if (!existsSync(envPath)) {
    return false;
  }

  process.loadEnvFile(envPath);
  return true;
}
