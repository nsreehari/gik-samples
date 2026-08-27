import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadMcpServerEnv } from '../src/load-env.js';

const serverDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const configurableVariables = [
  'AZURE_AI_FOUNDRY_PROJECT_ENDPOINT',
  'AZURE_CLI_COMMAND',
  'COPILOT_PROVISIONING_PLAN',
  'DISABLE_HANDLERS',
  'FOUNDRY_PROVISIONING_PLAN',
  'GIK_ALLOWED_ORIGINS',
  'GIK_CAPABILITY_CATALOG',
  'GIK_FILESYSTEM_STORAGE_ROOT',
  'GIK_MAX_ACTIVE_COPILOT_RUNS',
  'GIK_MCP_SERVER_URL',
  'GIK_PAIRING_CODE',
  'GIK_PAIRING_TOKEN_TTL_MS',
  'GIK_PROVISIONING_PLAN_TTL_MS',
  'GIK_SAMPLES_WORKSPACE_ROOT',
  'GIK_TARGET_WORKSPACE',
  'GIK_WORKSPACE_ROOTS',
  'LORE_ROOT_DIR',
];

test('the MCP environment template contains every user-configurable variable', () => {
  const template = fs.readFileSync(path.join(serverDirectory, '.env.template'), 'utf8');

  for (const variable of configurableVariables) {
    assert.match(template, new RegExp(`^#?${variable}=`, 'm'), `${variable} is missing`);
  }
});

test('the shared MCP environment loader reads a specified env file without overriding the process', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gik-mcp-env-'));
  const envPath = path.join(temporaryDirectory, '.env');
  const variable = 'GIK_ENV_CONFIGURATION_TEST';
  const previousValue = process.env[variable];

  try {
    fs.writeFileSync(envPath, `${variable}=from-file\n`, 'utf8');
    delete process.env[variable];
    assert.equal(loadMcpServerEnv(envPath), true);
    assert.equal(process.env[variable], 'from-file');

    process.env[variable] = 'from-process';
    fs.writeFileSync(envPath, `${variable}=replacement\n`, 'utf8');
    assert.equal(loadMcpServerEnv(envPath), true);
    assert.equal(process.env[variable], 'from-process');
  } finally {
    if (previousValue === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = previousValue;
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
