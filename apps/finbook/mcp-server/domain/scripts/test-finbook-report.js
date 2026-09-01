#!/usr/bin/env node
// test-finbook-report.js — Tests for finbook-core + finbook-report

const path = require('path');
const fs = require('fs');
const os = require('os');

const core = require('../lib/finbook-core.js');
const api = require('../lib/finbook-api.js');
const contract = require('../lib/finbook-contract.js');
const manifestBuilders = require('../lib/finbook-mcp-manifests.js');
const sqlite = require('../lib/finbook-sqlite.js');

function resolveFinbookFile(filename) {
  const candidate = path.join(__dirname, '..', filename);
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  throw new Error(`Unable to resolve Finbook package file: ${filename}`);
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

function makeDb() {
  return {
    config: {},
    accounts: [{
      account: 'Sarala',
      name: 'Sarala',
      SalaryIncome: [{ EffectiveDate: '2024-06-15', Employer: 'Acme', GrossTaxable: 500000, TDSDeducted: 50000 }],
      ForeignIncome: [],
      PropertyIncome: [],
      CapitalGainsConsolidated: [],
      OtherIncome: [{ IncomeDate: '2024-07-01', IncomeDescription: 'Interest', IncomeAmount: 1200 }],
      StockPurchasesOrTransferIns: [],
      StockSalesOrTransferOuts: [],
      AdvanceTax: [],
      ForeignAccounts: [],
      Properties: []
    }]
  };
}

console.log('\nfinbook report + manifest smoke tests\n');

test('finbook-core income summary returns totals for a valid account context', () => {
  const db = makeDb();
  const ctx = core.createContext(db, 'Sarala');
  const result = core.reports.incomeSummary(ctx, '2024-25');
  assert(result && typeof result === 'object', 'expected income summary object');
  assert(result.totalIncome > 0, 'expected positive income total');
});

test('date-only finance fields are independent of the server timezone', () => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    assert(core.dateToFY('2025-04-01') === '2025-26', 'expected FY to start on April 1');
    assert(core.dateToQFY('2025-04-01') === 'Q1', 'expected April to be Q1');
    assert(core.dateToCgQ('2025-06-16') === 'cgQ2', 'expected June 16 to be capital-gains Q2');
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('holdings default to today and exclude future purchases', () => {
  const db = makeDb();
  db.accounts[0].StockPurchasesOrTransferIns.push({
    PurchaseDate: '2099-01-01',
    SecurityName: 'FUTURE',
    PurchaseQuantity: 10,
    PurchasePricePerUnit: 100,
    TotalPurchaseValue: 1000,
    TotalPurchaseValueINR: 1000,
    CurrencyCode: 'INR',
    PurchaseLotID: 'future-lot'
  });
  const result = core.reports.holdings(core.createContext(db, 'Sarala'));
  assert(!result.holdings.some((holding) => holding.security === 'FUTURE'), 'expected future purchase to be excluded');
});

test('finbook-api lists known accounts', () => {
  const db = makeDb();
  const accounts = api.listAccounts(db);
  assert(Array.isArray(accounts), 'expected accounts array');
  assert(accounts.some((entry) => entry.account === 'Sarala'), 'expected Sarala account');
});

test('finbook contract includes journal read tools', () => {
  const toolNames = contract.getToolContract().tools.map((tool) => tool.name);
  assert(toolNames.includes('finbook.list_journal_entries'), 'expected finbook.list_journal_entries');
  assert(toolNames.includes('finbook.get_journal_summary'), 'expected finbook.get_journal_summary');
});

test('manifest builders stay aligned with the live contract', () => {
  const semanticManifest = manifestBuilders.buildSemanticManifest();
  const executableManifest = manifestBuilders.buildExecutableManifest();
  const contractToolNames = contract.getToolContract().tools.map((tool) => tool.name).sort();
  const semanticToolNames = Object.values(semanticManifest.tools).flat().map((tool) => tool.name).sort();
  const executableToolNames = executableManifest.tools.map((tool) => tool.name).sort();
  assert(JSON.stringify(semanticToolNames) === JSON.stringify(contractToolNames), 'semantic manifest tool names must match contract');
  assert(JSON.stringify(executableToolNames) === JSON.stringify(contractToolNames), 'executable manifest tool names must match contract');
});

test('manifest generator writes the Finbook package files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finbook-manifests-'));
  try {
    const result = manifestBuilders.writeManagedTruthsetsManifests(tmpDir);
    for (const filePath of [result.semanticPath, result.executablePath, result.capabilitiesPath, result.computedViewsPath, result.schemaPath]) {
      assert(fs.existsSync(filePath), `expected generated file: ${path.basename(filePath)}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runtime SQLite DB bootstraps from JSON samples only when missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finbook-bootstrap-'));
  try {
    const dbDir = path.join(tmpDir, 'DB');
    fs.mkdirSync(dbDir, { recursive: true });

    const liveDbPath = path.join(dbDir, 'finbook.sqlite');
    const sampleDbPath = api.getSampleDbFilePath(liveDbPath);
    const sampleJournalPath = api.getSampleJournalFilePath(liveDbPath);

    const sampleDb = makeDb();
    sampleDb.config.Defaults = [{ Key: 'sample-default', Broker: 'Interactive Brokers', Note: 'Bootstrap sample' }];
    fs.writeFileSync(sampleDbPath, JSON.stringify(sampleDb, null, 2), 'utf-8');
    fs.writeFileSync(sampleJournalPath, `${JSON.stringify(api.createJournalEntry('finbook.patch_config', { patch: { bootstrapSeed: true } }, { surface: 'sample' }))}\n`, 'utf-8');

    const first = api.ensureRuntimeFilesFromSamples(liveDbPath);
    assert(first.dbCreated === true, 'expected live DB to be created from sample');
    assert(first.journalCreated === true, 'expected sample journal entries to be imported');
    assert(fs.existsSync(liveDbPath), 'expected live DB file to exist');
    assert(api.loadDb(liveDbPath).accounts[0].account === 'Sarala', 'expected sample account to be imported');
    require('node:assert').deepStrictEqual(api.loadDb(liveDbPath), sampleDb, 'expected lossless sample round trip');
    assert(api.loadJournal(liveDbPath).length === 1, 'expected sample journal to be imported');

    api.saveDb(liveDbPath, { config: { preserved: true }, accounts: [] });
    api.saveJournal(liveDbPath, [
      api.createJournalEntry('finbook.patch_config', { patch: { preserved: true } }, { surface: 'test' })
    ]);

    const second = api.ensureRuntimeFilesFromSamples(liveDbPath);
    assert(second.dbCreated === false, 'expected existing live DB to remain untouched');
    assert(second.journalCreated === false, 'expected existing live journal to remain untouched');
    assert(api.loadDb(liveDbPath).config.preserved === true, 'expected modified live DB to remain preserved');
    assert(api.loadJournal(liveDbPath)[0].payload.patch.preserved === true, 'expected modified live journal to remain preserved');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SQLite storage uses relational domain tables and JSON only for flexible values', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finbook-schema-'));
  const dbPath = path.join(tmpDir, 'finbook.sqlite');
  try {
    api.saveDb(dbPath, makeDb());
    const db = sqlite.openDatabase(dbPath);
    try {
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
      assert(tables.has('accounts'), 'expected relational accounts table');
      assert(tables.has('salary_income'), 'expected relational salary table');
      assert(tables.has('stock_sale_purchase_lots'), 'expected normalized stock lot allocation table');
      assert(tables.has('journal_entries'), 'expected SQLite journal table');
      assert(db.prepare('SELECT count(*) count FROM salary_income').get().count === 1, 'expected typed salary row');
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SQLite bootstrap prefers legacy live JSON over checked-in samples', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finbook-legacy-'));
  const dbDir = path.join(tmpDir, 'DB');
  const dbPath = path.join(dbDir, 'finbook.sqlite');
  try {
    fs.mkdirSync(dbDir, { recursive: true });
    const legacyDb = makeDb();
    legacyDb.config.Source = 'legacy-live';
    const sampleDb = makeDb();
    sampleDb.config.Source = 'sample';
    fs.writeFileSync(path.join(dbDir, 'finbook.json'), JSON.stringify(legacyDb), 'utf-8');
    fs.writeFileSync(path.join(dbDir, 'finbook.sample.json'), JSON.stringify(sampleDb), 'utf-8');
    fs.writeFileSync(
      path.join(dbDir, 'finbook.journal.jsonl'),
      `${JSON.stringify(api.createJournalEntry('finbook.patch_config', { patch: { fromLegacy: true } }))}\n`,
      'utf-8'
    );

    const result = api.ensureRuntimeFilesFromSamples(dbPath);
    assert(result.importedFrom === path.join(dbDir, 'finbook.json'), 'expected legacy live DB import source');
    assert(api.loadDb(dbPath).config.Source === 'legacy-live', 'expected legacy live DB contents');
    assert(api.loadJournal(dbPath).length === 1, 'expected legacy journal import');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('legacy migration uses matched journal sources and leaves no partial database', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finbook-atomic-'));
  const dbDir = path.join(tmpDir, 'DB');
  const dbPath = path.join(dbDir, 'finbook.sqlite');
  try {
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(path.join(dbDir, 'finbook.json'), JSON.stringify(makeDb()), 'utf-8');
    fs.writeFileSync(
      path.join(dbDir, 'finbook.sample.journal.jsonl'),
      `${JSON.stringify(api.createJournalEntry('finbook.patch_config', { patch: { mustNotImport: true } }))}\n`,
      'utf-8'
    );
    api.ensureRuntimeFilesFromSamples(dbPath);
    assert(api.loadJournal(dbPath).length === 0, 'expected no sample journal mixed into legacy migration');

    fs.rmSync(dbPath, { force: true });
    fs.writeFileSync(path.join(dbDir, 'finbook.journal.jsonl'), '{invalid-json}\n', 'utf-8');
    let failed = false;
    try {
      api.ensureRuntimeFilesFromSamples(dbPath);
    } catch {
      failed = true;
    }
    assert(failed, 'expected malformed legacy journal migration to fail');
    assert(!fs.existsSync(dbPath), 'expected failed migration to leave no partial live database');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);