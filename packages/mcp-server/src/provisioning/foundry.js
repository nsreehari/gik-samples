const MAX_AGENTS = 20;
const MAX_PLAN_BYTES = 1024 * 1024;

function statusCode(error) {
  return Number(error?.statusCode ?? error?.status);
}

export function validateFoundryAgents(agents) {
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error('Foundry provisioning requires a non-empty agents array');
  }
  if (agents.length > MAX_AGENTS) {
    throw new Error(`Foundry provisioning exceeds the ${MAX_AGENTS}-agent limit`);
  }
  if (Buffer.byteLength(JSON.stringify(agents), 'utf8') > MAX_PLAN_BYTES) {
    throw new Error(`Foundry provisioning exceeds ${MAX_PLAN_BYTES} bytes`);
  }
  const ids = new Set();
  return agents.map((entry) => {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(id)) {
      throw new Error(`Invalid Foundry agent id: ${id || '(empty)'}`);
    }
    if (ids.has(id)) throw new Error(`Duplicate Foundry agent id '${id}'`);
    ids.add(id);
    if (!entry.definition || entry.definition.kind !== 'prompt') {
      throw new Error(`Agent '${id}' requires a Foundry prompt definition`);
    }
    return { id, definition: entry.definition };
  });
}

export async function createFoundryProjectClient(endpoint) {
  const value = String(endpoint || '').trim();
  if (!value) throw new Error('AZURE_AI_FOUNDRY_PROJECT_ENDPOINT is not configured');
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('The Foundry project endpoint must use HTTPS');
  let projectsModule;
  let identityModule;
  try {
    [projectsModule, identityModule] = await Promise.all([
      import('@azure/ai-projects'),
      import('@azure/identity'),
    ]);
  } catch (error) {
    throw new Error(
      `Foundry support requires the optional @azure/ai-projects and @azure/identity packages: ${error.message}`,
    );
  }
  return new projectsModule.AIProjectClient(value, new identityModule.AzureCliCredential());
}

export async function previewFoundryPlan(agents, project) {
  const normalized = validateFoundryAgents(agents);
  const actions = [];
  for (const agent of normalized) {
    try {
      const existing = await project.agents.get(agent.id);
      actions.push({
        agentId: agent.id,
        operation: 'create-version',
        currentVersion: existing?.versions?.latest?.version ?? null,
      });
    } catch (error) {
      if (statusCode(error) !== 404) throw error;
      actions.push({ agentId: agent.id, operation: 'create' });
    }
  }
  return actions;
}

export async function applyFoundryPlan(agents, project) {
  const normalized = validateFoundryAgents(agents);
  const results = [];
  for (const agent of normalized) {
    let exists = true;
    try {
      await project.agents.get(agent.id);
    } catch (error) {
      if (statusCode(error) !== 404) throw error;
      exists = false;
    }
    const result = exists
      ? await project.agents.createVersion(agent.id, agent.definition)
      : await project.agents.create(agent.id, agent.definition);
    const version = result?.version ?? result?.versions?.latest?.version;
    if (!version) throw new Error(`Foundry did not return a version for agent '${agent.id}'`);
    results.push({ agentId: agent.id, operation: exists ? 'create-version' : 'create', version });
  }
  return results;
}

export async function verifyFoundryPlan(agents, applied, project) {
  const normalized = validateFoundryAgents(agents);
  const versions = new Map((applied || []).map((entry) => [entry.agentId, entry.version]));
  const results = [];
  for (const agent of normalized) {
    try {
      const current = await project.agents.get(agent.id);
      const actualVersion = current?.versions?.latest?.version ?? null;
      const expectedVersion = versions.get(agent.id) ?? null;
      results.push({
        agentId: agent.id,
        ok: expectedVersion === null || actualVersion === expectedVersion,
        expectedVersion,
        actualVersion,
      });
    } catch (error) {
      if (statusCode(error) !== 404) throw error;
      results.push({ agentId: agent.id, ok: false, expectedVersion: versions.get(agent.id) ?? null, actualVersion: null });
    }
  }
  return results;
}

export async function smokeTestFoundryAgent(agentId, message, project) {
  const id = String(agentId || '').trim();
  const prompt = String(message || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(id)) throw new Error('A valid Foundry agent id is required');
  if (!prompt || prompt.length > 12_000) throw new Error('Smoke-test message must contain 1 to 12000 characters');
  const openai = project.getOpenAIClient();
  const conversation = await openai.conversations.create({
    items: [{ type: 'message', role: 'user', content: prompt }],
  });
  const response = await openai.responses.create(
    { conversation: conversation.id },
    {
      body: { agent_reference: { name: id, type: 'agent_reference' } },
      timeout: 120_000,
    },
  );
  return {
    agentId: id,
    conversationId: conversation.id,
    responseId: response.id,
    reply: String(response.output_text || '').trim(),
    toolCalls: Array.isArray(response.output)
      ? response.output
          .filter((item) => item?.type === 'function_call')
          .map((item) => ({ callId: item.call_id, name: item.name, arguments: item.arguments }))
      : [],
  };
}
