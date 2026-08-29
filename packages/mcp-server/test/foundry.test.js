import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyFoundryPlan,
  normalizeFoundryProjectEndpoint,
  previewFoundryPlan,
  smokeTestFoundryAgent,
  validateFoundryAgents,
  verifyFoundryPlan,
} from '../src/provisioning/foundry.js';

function fakeProject() {
  const state = new Map([['existing', '1']]);
  return {
    state,
    agents: {
      async get(id) {
        if (!state.has(id)) throw Object.assign(new Error('not found'), { statusCode: 404 });
        return { name: id, versions: { latest: { version: state.get(id) } } };
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
        conversations: {
          create: async () => ({ id: 'conversation-1' }),
        },
        responses: {
          create: async () => ({
            id: 'response-1',
            output_text: 'ready',
            output: [{ type: 'function_call', call_id: 'call-1', name: 'inspect', arguments: '{}' }],
          }),
        },
      };
    },
  };
}

const agents = [
  { id: 'existing', definition: { kind: 'prompt', model: 'model', instructions: 'Existing' } },
  { id: 'new-agent', definition: { kind: 'prompt', model: 'model', instructions: 'New' } },
];

test('Foundry provisioning preserves create-versus-create behavior from the source applicator', async () => {
  const project = fakeProject();
  assert.deepEqual(await previewFoundryPlan(agents, project), [
    { agentId: 'existing', operation: 'create-version', currentVersion: '1' },
    { agentId: 'new-agent', operation: 'create' },
  ]);
  const applied = await applyFoundryPlan(agents, project);
  assert.deepEqual(applied, [
    { agentId: 'existing', operation: 'create-version', version: '2' },
    { agentId: 'new-agent', operation: 'create', version: '1' },
  ]);
  const verified = await verifyFoundryPlan(agents, applied, project);
  assert.equal(verified.every((entry) => entry.ok), true);
});

test('Foundry smoke tests use named-agent conversations and return tool calls', async () => {
  const result = await smokeTestFoundryAgent('existing', 'Are you ready?', fakeProject());
  assert.equal(result.reply, 'ready');
  assert.deepEqual(result.toolCalls, [
    { callId: 'call-1', name: 'inspect', arguments: '{}' },
  ]);
});

test('Foundry plan validation rejects duplicate or non-prompt agents', () => {
  assert.throws(() => validateFoundryAgents([
    agents[0],
    agents[0],
  ]), /Duplicate/);
  assert.throws(() => validateFoundryAgents([
    { id: 'invalid', definition: { kind: 'workflow' } },
  ]), /prompt definition/);
});

test('Foundry project endpoints are restricted to canonical Azure AI project resources', () => {
  assert.equal(
    normalizeFoundryProjectEndpoint('https://example.services.ai.azure.com/api/projects/sample/'),
    'https://example.services.ai.azure.com/api/projects/sample',
  );
  assert.throws(
    () => normalizeFoundryProjectEndpoint('https://evil.example/api/projects/sample'),
    /Azure AI services host/,
  );
  assert.throws(
    () => normalizeFoundryProjectEndpoint('https://example.services.ai.azure.com:8443/api/projects/sample'),
    /cannot include/,
  );
  assert.throws(
    () => normalizeFoundryProjectEndpoint('https://example.services.ai.azure.com/api/projects/sample?redirect=evil'),
    /cannot include/,
  );
});
