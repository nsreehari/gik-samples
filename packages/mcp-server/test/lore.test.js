import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { handleLoreTool } from '../src/handlers/lore.js';

function tool(rootPath, name) {
  return {
    name,
    manifestPath: path.join(rootPath, 'manifest.json'),
    config: { rootPath },
  };
}

test('Lore retains scoped set, append, listing, and deprecation behavior', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gik-lore-'));
  try {
    const setResult = await handleLoreTool(
      { scope: 'app/copilot', key: 'source-roots', value: [{ id: 'one' }] },
      tool(root, 'lore.set'),
    );
    assert.equal(setResult.structuredContent.ok, true);
    assert.equal(setResult.structuredContent.data.created, true);

    await handleLoreTool(
      { scope: 'app/copilot', key: 'source-roots', value: [{ id: 'two' }] },
      tool(root, 'lore.append'),
    );
    const getResult = await handleLoreTool(
      { scope: 'app/copilot', key: 'source-roots' },
      tool(root, 'lore.get'),
    );
    assert.deepEqual(getResult.structuredContent.data.entry.value, [{ id: 'one' }, { id: 'two' }]);

    const scopes = await handleLoreTool({ prefix: 'app/' }, tool(root, 'lore.list_scopes'));
    assert.deepEqual(scopes.structuredContent.data.scopes, ['app/copilot']);

    await handleLoreTool(
      { scope: 'app/copilot', key: 'source-roots' },
      tool(root, 'lore.deprecate'),
    );
    const visible = await handleLoreTool(
      { scope: 'app/copilot' },
      tool(root, 'lore.get_all'),
    );
    assert.equal(visible.structuredContent.data.count, 0);
    const all = await handleLoreTool(
      { scope: 'app/copilot', includeDeprecated: true },
      tool(root, 'lore.get_all'),
    );
    assert.equal(all.structuredContent.data.count, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Lore rejects invalid scopes without writing data', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gik-lore-invalid-'));
  try {
    const result = await handleLoreTool(
      { scope: '../outside', key: 'bad', value: true },
      tool(root, 'lore.set'),
    );
    assert.equal(result.structuredContent.ok, false);
    assert.equal(result.structuredContent.error.code, 'lore_scope_invalid');
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
