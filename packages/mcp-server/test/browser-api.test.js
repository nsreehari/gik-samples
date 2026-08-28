import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProvisioningBrowserApi } from '../src/provisioning/browser-api.js';

test('browser API pairs exact origins and applies only reviewed plans to configured roots', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gik-browser-api-'));
  const workspace = path.join(temporary, 'workspace');
  const dataRoot = path.join(temporary, 'data');
  fs.mkdirSync(workspace);
  let currentTime = Date.parse('2026-01-01T00:00:00.000Z');
  const codes = [];
  const api = createProvisioningBrowserApi({
    env: {
      GIK_ALLOWED_ORIGINS: 'https://example.github.io',
      GIK_WORKSPACE_ROOTS: `workspace=${workspace}`,
      GIK_PAIRING_CODE: '123456',
      GIK_PAIRING_TOKEN_TTL_MS: '60000',
      GIK_PROVISIONING_PLAN_TTL_MS: '30000',
    },
    dataRoot,
    now: () => currentTime,
    onPairingCode: (code) => codes.push(code),
    azureCliRunner: () => '{"azure-cli":"available"}',
  });

  try {
    assert.throws(
      () => api.pair({ origin: 'https://evil.example', code: '123456' }),
      /Origin is not allowed/,
    );
    const paired = api.pair({ origin: 'https://example.github.io', code: '123456' });
    assert.equal(typeof paired.bearerToken, 'string');
    assert.notEqual(codes.at(-1), '123456');
    const environment = await api.operation('environment');
    assert.equal(environment.azureCli.available, true);
    assert.equal(environment.azureCli.command, 'az');
    api.authorize({
      origin: 'https://example.github.io',
      authorization: `Bearer ${paired.bearerToken}`,
    });

    const files = [{ path: '.github/agents/sample.agent.md', content: '# Agent\n' }];
    const plan = await api.operation('copilot_workspace_plan', {
      workspaceRootId: 'workspace',
      files,
    });
    assert.equal(plan.actions[0].operation, 'create');
    assert.equal(fs.existsSync(path.join(workspace, '.github')), false);

    await assert.rejects(
      api.operation('copilot_workspace_apply', { ...plan, planDigest: 'wrong' }),
      /identity does not match/,
    );
    const applied = await api.operation('copilot_workspace_apply', plan);
    assert.equal(applied.actions[0].operation, 'create');
    const verified = await api.operation('copilot_workspace_verify', plan);
    assert.equal(verified.ok, true);

    currentTime += 60_001;
    assert.throws(
      () => api.authorize({
        origin: 'https://example.github.io',
        authorization: `Bearer ${paired.bearerToken}`,
      }),
      /expired/,
    );
    assert.equal(fs.existsSync(path.join(dataRoot, 'audit', 'provisioning.jsonl')), true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('browser API rejects wildcard origins and unknown workspace identifiers', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gik-browser-api-invalid-'));
  try {
    assert.throws(
      () => createProvisioningBrowserApi({
        env: { GIK_ALLOWED_ORIGINS: '*', GIK_WORKSPACE_ROOTS: `workspace=${temporary}` },
        dataRoot: temporary,
      }),
      /does not support wildcards/,
    );
    const api = createProvisioningBrowserApi({
      env: {
        GIK_ALLOWED_ORIGINS: 'http://localhost:5175',
        GIK_WORKSPACE_ROOTS: `workspace=${temporary}`,
      },
      dataRoot: temporary,
    });
    await assert.rejects(
      api.operation('copilot_workspace_plan', {
        workspaceRootId: 'outside',
        files: [{ path: 'agent.md', content: '' }],
      }),
      /Unknown workspace root id/,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('browser API carries Foundry preview, apply, verify, and smoke through one reviewed plan', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gik-browser-foundry-'));
  const state = new Map();
  const project = {
    agents: {
      async get(id) {
        if (!state.has(id)) throw Object.assign(new Error('not found'), { statusCode: 404 });
        return { versions: { latest: { version: state.get(id) } } };
      },
      async create(id) {
        state.set(id, '1');
        return { versions: { latest: { version: '1' } } };
      },
      async createVersion(id) {
        const version = String(Number(state.get(id)) + 1);
        state.set(id, version);
        return { version };
      },
    },
    getOpenAIClient() {
      return {
        conversations: { create: async () => ({ id: 'conversation' }) },
        responses: { create: async () => ({ id: 'response', output_text: 'ok', output: [] }) },
      };
    },
  };
  let foundryClientCalls = 0;
  const api = createProvisioningBrowserApi({
    env: {
      GIK_ALLOWED_ORIGINS: 'http://localhost:5175',
      GIK_WORKSPACE_ROOTS: `workspace=${temporary}`,
    },
    dataRoot: temporary,
    foundryClientFactory: async () => {
      foundryClientCalls += 1;
      return project;
    },
  });
  const agents = [{
    id: 'sample-agent',
    definition: { kind: 'prompt', model: 'model', instructions: 'Be useful.' },
  }];
  try {
    const projectEndpoint = 'https://example.services.ai.azure.com/api/projects/example';
    const plan = await api.operation('foundry_plan', { agents, projectEndpoint });
    assert.equal(plan.actions[0].operation, 'reconcile');
    assert.equal(plan.target.projectEndpoint, projectEndpoint);
    assert.equal(foundryClientCalls, 0);
    const applied = await api.operation('foundry_apply', plan);
    assert.equal(foundryClientCalls, 1);
    assert.equal(applied.agents[0].version, '1');
    await assert.rejects(api.operation('foundry_apply', plan), /already applied/);
    assert.equal((await api.operation('foundry_verify', plan)).ok, true);
    assert.equal((await api.operation('foundry_smoke', {
      ...plan,
      agentId: 'sample-agent',
      message: 'Check readiness.',
    })).reply, 'ok');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
