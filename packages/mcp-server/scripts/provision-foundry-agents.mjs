#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyFoundryPlan,
  createFoundryProjectClient,
  previewFoundryPlan,
  validateFoundryAgents,
  verifyFoundryPlan,
} from '../src/provisioning/foundry.js';

function parseArgs(argv) {
  const options = {
    plan: process.env.FOUNDRY_PROVISIONING_PLAN,
    endpoint: process.env.AZURE_AI_FOUNDRY_PROJECT_ENDPOINT,
    dryRun: false,
    verify: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--plan') options.plan = argv[index += 1];
    else if (argument === '--endpoint') options.endpoint = argv[index += 1];
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--verify') options.verify = true;
    else if (argument === '--help' || argument === '-h') {
      console.log('Usage: provision-foundry-agents.mjs --plan <gik-project.json> --endpoint <https-url> [--dry-run] [--verify]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.plan) throw new Error('--plan or FOUNDRY_PROVISIONING_PLAN is required');
  if (!options.endpoint) {
    throw new Error('--endpoint or AZURE_AI_FOUNDRY_PROJECT_ENDPOINT is required');
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const plan = JSON.parse(readFileSync(resolve(options.plan), 'utf8'));
if (plan?.format !== 'gik-project/1' || plan?.provider !== 'foundry') {
  throw new Error('Expected a gik-project/1 Foundry provisioning plan');
}
const agents = validateFoundryAgents(plan.agents);
const project = await createFoundryProjectClient(options.endpoint);
const preview = await previewFoundryPlan(agents, project);
console.log(JSON.stringify({ endpoint: options.endpoint, actions: preview }, null, 2));
if (!options.dryRun) {
  const applied = await applyFoundryPlan(agents, project);
  console.log(JSON.stringify({ applied }, null, 2));
  if (options.verify) {
    const verified = await verifyFoundryPlan(agents, applied, project);
    console.log(JSON.stringify({ ok: verified.every((entry) => entry.ok), agents: verified }, null, 2));
  }
}
