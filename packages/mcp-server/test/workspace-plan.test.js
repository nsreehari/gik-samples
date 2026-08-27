import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyWorkspacePlan,
  previewWorkspacePlan,
  validateWorkspaceFiles,
  verifyWorkspacePlan,
} from '../src/provisioning/workspace-plan.js';

test('workspace plans preview, apply, and verify portable files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gik-workspace-plan-'));
  const files = [
    { path: '.github/agents/sample.agent.md', content: '# Sample\n' },
    { path: '.gik/provisioning/sample.json', content: '{}\n' },
  ];
  try {
    assert.deepEqual(previewWorkspacePlan(root, files).map(({ operation }) => operation), ['create', 'create']);
    assert.deepEqual(applyWorkspacePlan(root, files).map(({ operation }) => operation), ['create', 'create']);
    assert.equal(verifyWorkspacePlan(root, files).every(({ ok }) => ok), true);
    assert.deepEqual(previewWorkspacePlan(root, files).map(({ operation }) => operation), ['unchanged', 'unchanged']);

    fs.writeFileSync(path.join(root, '.github', 'agents', 'sample.agent.md'), '# Changed\n');
    assert.equal(previewWorkspacePlan(root, files)[0].operation, 'update');
    assert.equal(verifyWorkspacePlan(root, files)[0].reason, 'content-mismatch');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('workspace plans reject traversal, platform paths, duplicates, and oversized content', () => {
  assert.throws(() => validateWorkspaceFiles([{ path: '../outside', content: '' }]), /escapes/);
  assert.throws(() => validateWorkspaceFiles([{ path: 'C:\\outside', content: '' }]), /portable/);
  assert.throws(() => validateWorkspaceFiles([
    { path: 'same', content: 'a' },
    { path: 'same', content: 'b' },
  ]), /Duplicate/);
  assert.throws(() => validateWorkspaceFiles([
    { path: 'large', content: 'x'.repeat(512 * 1024 + 1) },
  ]), /exceeds/);
});
