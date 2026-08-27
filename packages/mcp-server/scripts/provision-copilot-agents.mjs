#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  applyWorkspacePlan,
  previewWorkspacePlan,
  validateWorkspaceFiles,
} from '../src/provisioning/workspace-plan.js';

function parseArgs(argv) {
  const options = {
    plan: process.env.COPILOT_PROVISIONING_PLAN,
    targetDir: process.env.GIK_TARGET_WORKSPACE
      ? path.resolve(process.env.GIK_TARGET_WORKSPACE)
      : '',
    dryRun: false,
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--plan') options.plan = argv[index += 1];
    else if (argument === '--target-dir') options.targetDir = path.resolve(process.cwd(), argv[index += 1]);
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--force') options.force = true;
    else if (argument === '--help' || argument === '-h') {
      console.log(`Usage: provision-copilot-agents.mjs --plan <plan.json> [options]\n\nOptions:\n  --target-dir <path>  Workspace directory\n  --dry-run            List planned files without writing\n  --force              Overwrite changed managed files\n`);
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.plan) throw new Error('--plan or COPILOT_PROVISIONING_PLAN is required');
  if (!options.targetDir) throw new Error('--target-dir or GIK_TARGET_WORKSPACE is required');
  return options;
}

function readPlan(filePath) {
  const plan = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  if (plan?.format !== 'gik-project/1' || plan?.provider !== 'copilot') {
    throw new Error('Expected a gik-project/1 Copilot provisioning plan');
  }
  validateWorkspaceFiles(plan?.files);
  return plan;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function initializeRepository(targetDir) {
  if (fs.existsSync(path.join(targetDir, '.git'))) return;
  execFileSync('git', ['init'], { cwd: targetDir, stdio: 'ignore' });
}

const options = parseArgs(process.argv.slice(2));
const plan = readPlan(options.plan);

if (options.dryRun) {
  console.log(`Dry run: would provision ${plan.files.length} files under ${options.targetDir}`);
  const actions = fs.existsSync(options.targetDir)
    ? previewWorkspacePlan(options.targetDir, plan.files)
    : validateWorkspaceFiles(plan.files).map((file) => ({ ...file, operation: 'create' }));
  for (const action of actions) {
    console.log(`${action.operation}: ${path.join(options.targetDir, action.path)}`);
  }
  process.exit(0);
}

ensureDirectory(options.targetDir);
initializeRepository(options.targetDir);
const selectedFiles = options.force
  ? plan.files
  : plan.files.filter((file) => {
      const filePath = path.join(options.targetDir, ...file.path.split('/'));
      if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') === file.content) return true;
      console.log(`Preserving existing file (use --force to overwrite): ${filePath}`);
      return false;
    });
if (selectedFiles.length > 0) {
  for (const action of applyWorkspacePlan(options.targetDir, selectedFiles)) {
    console.log(`${action.operation === 'unchanged' ? 'Unchanged' : 'Created/updated'}: ${path.join(options.targetDir, action.path)}`);
  }
}
