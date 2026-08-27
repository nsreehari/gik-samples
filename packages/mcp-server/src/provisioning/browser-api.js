import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { handleCopilotTool } from '../handlers/copilot.js';
import {
  applyWorkspacePlan,
  previewWorkspacePlan,
  validateWorkspaceFiles,
  verifyWorkspacePlan,
} from './workspace-plan.js';
import {
  applyFoundryPlan,
  createFoundryProjectClient,
  previewFoundryPlan,
  smokeTestFoundryAgent,
  validateFoundryAgents,
  verifyFoundryPlan,
} from './foundry.js';

const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000;
const DEFAULT_PLAN_TTL_MS = 5 * 60 * 1000;
const MAX_PAIR_ATTEMPTS_PER_MINUTE = 5;
const MAX_OPERATIONS_PER_MINUTE = 60;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseAllowedOrigins(raw) {
  const configured = String(raw || 'http://localhost:5175,http://127.0.0.1:5175')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const origins = new Set();
  for (const value of configured) {
    if (value.includes('*')) throw new Error('GIK_ALLOWED_ORIGINS does not support wildcards');
    const url = new URL(value);
    if (url.origin !== value || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`GIK_ALLOWED_ORIGINS entry must be an exact HTTP(S) origin: ${value}`);
    }
    origins.add(value);
  }
  if (origins.size === 0) throw new Error('GIK_ALLOWED_ORIGINS must contain at least one exact origin');
  return origins;
}

function parseWorkspaceRoots(raw, defaultWorkspaceRoot) {
  const entries = String(raw || '')
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean);
  if (entries.length === 0 && defaultWorkspaceRoot) {
    entries.push(`workspace=${defaultWorkspaceRoot}`);
  }
  const roots = new Map();
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    if (separator <= 0) throw new Error(`Invalid GIK_WORKSPACE_ROOTS entry: ${entry}`);
    const id = entry.slice(0, separator).trim();
    const configuredPath = entry.slice(separator + 1).trim();
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(id)) {
      throw new Error(`Invalid workspace root id: ${id}`);
    }
    const root = path.resolve(configuredPath);
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      throw new Error(`Configured workspace root does not exist: ${root}`);
    }
    if (roots.has(id)) throw new Error(`Duplicate workspace root id: ${id}`);
    roots.set(id, root);
  }
  if (roots.size === 0) throw new Error('At least one browser provisioning workspace root is required');
  return roots;
}

function probeCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });
  return {
    available: !result.error && result.status === 0,
    command,
    ...(result.error ? { error: result.error.message } : {}),
  };
}

function pairingCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function publicPlan(plan) {
  return {
    planId: plan.id,
    planDigest: plan.digest,
    expiresAt: plan.expiresAt,
    actions: plan.actions,
  };
}

export function createProvisioningBrowserApi({
  env = process.env,
  defaultWorkspaceRoot,
  dataRoot,
  now = () => Date.now(),
  onPairingCode = () => {},
  foundryClientFactory = createFoundryProjectClient,
} = {}) {
  const allowedOrigins = parseAllowedOrigins(env.GIK_ALLOWED_ORIGINS);
  const workspaceRoots = parseWorkspaceRoots(env.GIK_WORKSPACE_ROOTS, defaultWorkspaceRoot);
  const tokenTtlMs = positiveInteger(env.GIK_PAIRING_TOKEN_TTL_MS, DEFAULT_TOKEN_TTL_MS);
  const planTtlMs = positiveInteger(env.GIK_PROVISIONING_PLAN_TTL_MS, DEFAULT_PLAN_TTL_MS);
  const auditPath = path.join(path.resolve(dataRoot), 'audit', 'provisioning.jsonl');
  const tokens = new Map();
  const plans = new Map();
  const rateWindows = new Map();
  let activePairingCode = String(env.GIK_PAIRING_CODE || '').trim() || pairingCode();

  function audit(event, details = {}) {
    mkdirSync(path.dirname(auditPath), { recursive: true });
    appendFileSync(auditPath, `${JSON.stringify({
      timestamp: new Date(now()).toISOString(),
      event,
      ...details,
    })}\n`, 'utf8');
  }

  function rotatePairingCode() {
    activePairingCode = pairingCode();
    onPairingCode(activePairingCode);
  }

  function assertOrigin(origin) {
    if (!allowedOrigins.has(origin)) throw Object.assign(new Error('Origin is not allowed'), { statusCode: 403 });
  }

  function consumeRateLimit(key, limit) {
    const current = now();
    const start = current - 60_000;
    const recent = (rateWindows.get(key) || []).filter((timestamp) => timestamp > start);
    if (recent.length >= limit) {
      throw Object.assign(new Error('Rate limit exceeded'), { statusCode: 429 });
    }
    recent.push(current);
    rateWindows.set(key, recent);
  }

  function cleanup() {
    const current = now();
    for (const [key, token] of tokens) {
      if (token.expiresAtMs <= current) tokens.delete(key);
    }
    for (const [id, plan] of plans) {
      if (plan.expiresAtMs <= current) plans.delete(id);
    }
  }

  function pair({ origin, code, clientKey = 'browser' }) {
    assertOrigin(origin);
    consumeRateLimit(`pair:${clientKey}`, MAX_PAIR_ATTEMPTS_PER_MINUTE);
    if (!safeEqual(String(code || '').trim(), activePairingCode)) {
      audit('pair-rejected', { origin });
      throw Object.assign(new Error('Invalid pairing code'), { statusCode: 401 });
    }
    const bearerToken = randomBytes(32).toString('base64url');
    const tokenDigest = digest(bearerToken);
    const expiresAtMs = now() + tokenTtlMs;
    tokens.set(tokenDigest, { origin, expiresAtMs });
    audit('pair-succeeded', { origin, expiresAt: new Date(expiresAtMs).toISOString() });
    rotatePairingCode();
    return { bearerToken, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  function authorize({ origin, authorization, clientKey = 'browser' }) {
    assertOrigin(origin);
    consumeRateLimit(`operation:${clientKey}`, MAX_OPERATIONS_PER_MINUTE);
    cleanup();
    const match = /^Bearer\s+(.+)$/i.exec(String(authorization || ''));
    const token = match ? tokens.get(digest(match[1])) : null;
    if (!token || token.origin !== origin || token.expiresAtMs <= now()) {
      throw Object.assign(new Error('Pairing token is missing, expired, or invalid'), { statusCode: 401 });
    }
  }

  function workspaceRoot(id) {
    const root = workspaceRoots.get(String(id || ''));
    if (!root) throw Object.assign(new Error(`Unknown workspace root id: ${id}`), { statusCode: 400 });
    return root;
  }

  function createWorkspacePlan(input) {
    const rootId = String(input?.workspaceRootId || '');
    const root = workspaceRoot(rootId);
    const files = validateWorkspaceFiles(input?.files);
    const actions = previewWorkspacePlan(root, files);
    const id = randomBytes(18).toString('base64url');
    const planDigest = digest(JSON.stringify({ provider: 'copilot', rootId, files }));
    const expiresAtMs = now() + planTtlMs;
    const plan = {
      id,
      digest: planDigest,
      provider: 'copilot',
      rootId,
      files,
      actions,
      expiresAtMs,
      expiresAt: new Date(expiresAtMs).toISOString(),
      appliedAt: null,
    };
    plans.set(id, plan);
    audit('plan-created', { planId: id, provider: plan.provider, rootId, actionCount: actions.length });
    return publicPlan(plan);
  }

  async function createFoundryPlan(input) {
    const agents = validateFoundryAgents(input?.agents);
    const endpoint = String(env.AZURE_AI_FOUNDRY_PROJECT_ENDPOINT || '').trim();
    const project = await foundryClientFactory(endpoint);
    const actions = await previewFoundryPlan(agents, project);
    const id = randomBytes(18).toString('base64url');
    const planDigest = digest(JSON.stringify({ provider: 'foundry', endpoint, agents }));
    const expiresAtMs = now() + planTtlMs;
    const plan = {
      id,
      digest: planDigest,
      provider: 'foundry',
      endpoint,
      agents,
      actions,
      expiresAtMs,
      expiresAt: new Date(expiresAtMs).toISOString(),
      appliedAt: null,
      applied: [],
    };
    plans.set(id, plan);
    audit('plan-created', { planId: id, provider: plan.provider, actionCount: actions.length });
    return publicPlan(plan);
  }

  function resolvePlan(input, provider) {
    cleanup();
    const plan = plans.get(String(input?.planId || ''));
    if (!plan || plan.expiresAtMs <= now()) {
      throw Object.assign(new Error('Provisioning plan is missing or expired'), { statusCode: 410 });
    }
    if (plan.provider !== provider || !safeEqual(input?.planDigest, plan.digest)) {
      throw Object.assign(new Error('Provisioning plan identity does not match'), { statusCode: 409 });
    }
    return plan;
  }

  async function operation(name, input) {
    switch (name) {
      case 'environment':
        return {
          workspaceRoots: [...workspaceRoots].map(([id, root]) => ({ id, root })),
          copilot: probeCommand(process.platform === 'win32' ? 'copilot.exe' : 'copilot', ['--help']),
          azureCli: probeCommand(env.AZURE_CLI_COMMAND || 'az', ['version']),
          foundry: {
            configured: Boolean(String(env.AZURE_AI_FOUNDRY_PROJECT_ENDPOINT || '').trim()),
          },
        };
      case 'copilot_workspace_plan':
        return createWorkspacePlan(input);
      case 'foundry_plan':
        return createFoundryPlan(input);
      case 'copilot_workspace_apply': {
        const plan = resolvePlan(input, 'copilot');
        const actions = applyWorkspacePlan(workspaceRoot(plan.rootId), plan.files);
        plan.appliedAt = new Date(now()).toISOString();
        audit('plan-applied', { planId: plan.id, provider: plan.provider, rootId: plan.rootId });
        return { planId: plan.id, appliedAt: plan.appliedAt, actions };
      }
      case 'copilot_workspace_verify': {
        const plan = resolvePlan(input, 'copilot');
        const files = verifyWorkspacePlan(workspaceRoot(plan.rootId), plan.files);
        const ok = files.every((file) => file.ok);
        audit('plan-verified', { planId: plan.id, provider: plan.provider, rootId: plan.rootId, ok });
        return { planId: plan.id, ok, files };
      }
      case 'foundry_apply': {
        const plan = resolvePlan(input, 'foundry');
        if (plan.appliedAt) {
          throw Object.assign(
            new Error(`Foundry plan was already applied at ${plan.appliedAt}`),
            { statusCode: 409 },
          );
        }
        const project = await foundryClientFactory(plan.endpoint);
        plan.applied = await applyFoundryPlan(plan.agents, project);
        plan.appliedAt = new Date(now()).toISOString();
        audit('plan-applied', { planId: plan.id, provider: plan.provider });
        return { planId: plan.id, appliedAt: plan.appliedAt, agents: plan.applied };
      }
      case 'foundry_verify': {
        const plan = resolvePlan(input, 'foundry');
        const project = await foundryClientFactory(plan.endpoint);
        const agents = await verifyFoundryPlan(plan.agents, plan.applied, project);
        const ok = agents.every((agent) => agent.ok);
        audit('plan-verified', { planId: plan.id, provider: plan.provider, ok });
        return { planId: plan.id, ok, agents };
      }
      case 'foundry_smoke': {
        const plan = resolvePlan(input, 'foundry');
        const project = await foundryClientFactory(plan.endpoint);
        const agentId = String(input?.agentId || plan.agents[0]?.id || '');
        const result = await smokeTestFoundryAgent(agentId, input?.message, project);
        audit('foundry-smoke-completed', { planId: plan.id, agentId });
        return result;
      }
      case 'copilot_cli_run': {
        const rootId = String(input?.workspaceRootId || '');
        const result = await handleCopilotTool({
          cwd: workspaceRoot(rootId),
          message: input?.message,
          agent: input?.agent,
          model: input?.model,
          timeoutMs: Math.min(positiveInteger(input?.timeoutMs, 60_000), 300_000),
          runMode: 'sync',
          invocationMode: 'flag',
        }, { name: 'copilot.run_agent' });
        audit('copilot-run-completed', { rootId, agent: String(input?.agent || '') });
        return result.structuredContent;
      }
      default:
        throw Object.assign(new Error(`Unsupported browser operation: ${name}`), { statusCode: 404 });
    }
  }

  onPairingCode(activePairingCode);
  return {
    allowedOrigins,
    pair,
    authorize,
    operation,
  };
}
