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
import { loadMcpServerEnv } from '../src/load-env.js';

loadMcpServerEnv();

function parseArgs(argv) {
  const options = {
    plan: process.env.FOUNDRY_PROVISIONING_PLAN,
    dryRun: false,
    verify: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--plan') options.plan = argv[index += 1];
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--verify') options.verify = true;
    else if (argument === '--help' || argument === '-h') {
      console.log('Usage: provision-foundry-agents.mjs --plan <gik-project.json> [--dry-run] [--verify]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.plan) throw new Error('--plan or FOUNDRY_PROVISIONING_PLAN is required');
  return options;
}

const options = parseArgs(process.argv.slice(2));
const plan = JSON.parse(readFileSync(resolve(options.plan), 'utf8'));
if (plan?.format !== 'gik-project/1' || plan?.provider !== 'foundry') {
  throw new Error('Expected a gik-project/1 Foundry provisioning plan');
}
const agents = validateFoundryAgents(plan.agents);
const project = await createFoundryProjectClient(plan.projectEndpoint);
const preview = await previewFoundryPlan(agents, project);
console.log(JSON.stringify({ projectEndpoint: plan.projectEndpoint, actions: preview }, null, 2));
if (!options.dryRun) {
  const applied = await applyFoundryPlan(agents, project);
  console.log(JSON.stringify({ applied }, null, 2));
  if (options.verify) {
    const verified = await verifyFoundryPlan(agents, applied, project);
    console.log(JSON.stringify({ ok: verified.every((entry) => entry.ok), agents: verified }, null, 2));
  }
}
