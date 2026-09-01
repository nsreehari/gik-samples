'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const core = require('./finbook-core');

const TABLE_DEFINITIONS = {
  AdvanceTax: {
    sqlName: 'advance_tax',
    fields: {
      PaymentDate: 'TEXT',
      EffectiveDate: 'TEXT',
      TaxAmountPaid: 'REAL',
      PaymentDescription: 'TEXT',
      Remarks: 'TEXT',
      IsLocked: 'INTEGER'
    }
  },
  CapitalGainsConsolidated: {
    sqlName: 'capital_gains_consolidated',
    fields: {
      IncomeDate: 'TEXT',
      GainsType: 'TEXT',
      IncomeDescription: 'TEXT',
      SaleValue: 'REAL',
      AcquisitionCost: 'REAL',
      Expenses: 'REAL',
      TDSDeducted: 'REAL',
      TDSDeductor: 'TEXT',
      NonTaxable: 'INTEGER',
      Remarks: 'TEXT',
      IsLocked: 'INTEGER'
    }
  },
  ForeignIncome: {
    sqlName: 'foreign_income',
    fields: {
      IncomeDate: 'TEXT',
      IncomeSource: 'TEXT',
      IncomeType: 'TEXT',
      ForeignAccount: 'TEXT',
      Currency: 'TEXT',
      IncomeAmount: 'REAL',
      TaxesWithheld: 'REAL',
      ExchangeRateToINR: 'REAL',
      NonTaxable: 'INTEGER',
      Remarks: 'TEXT',
      IsLocked: 'INTEGER'
    }
  },
  OtherIncome: {
    sqlName: 'other_income',
    fields: {
      IncomeDate: 'TEXT',
      IncomeDescription: 'TEXT',
      IncomeAmount: 'REAL',
      TDSDeducted: 'REAL',
      TDSDeductor: 'TEXT',
      NonTaxable: 'INTEGER',
      Remarks: 'TEXT',
      IsLocked: 'INTEGER'
    }
  },
  PropertyIncome: {
    sqlName: 'property_income',
    fields: {
      IncomeDate: 'TEXT',
      PropertyID: 'TEXT',
      GrossIncome: 'REAL',
      TotalExpenses: 'REAL',
      TDSDeducted: 'REAL',
      TDSDeductor: 'TEXT',
      Details: 'TEXT',
      IsLocked: 'INTEGER'
    }
  },
  SalaryIncome: {
    sqlName: 'salary_income',
    fields: {
      EffectiveDate: 'TEXT',
      Employer: 'TEXT',
      GrossTaxable: 'REAL',
      TaxablePerquisites: 'REAL',
      Exemptions: 'REAL',
      Deductions: 'REAL',
      TDSDeducted: 'REAL',
      Remarks: 'TEXT',
      IsLocked: 'INTEGER'
    }
  },
  StockPurchasesOrTransferIns: {
    sqlName: 'stock_purchases',
    fields: {
      PurchaseDate: 'TEXT',
      BrokerageName: 'TEXT',
      SecurityName: 'TEXT',
      CurrencyCode: 'TEXT',
      PurchaseQuantity: 'REAL',
      PurchasePricePerUnit: 'REAL',
      PurchaseExpenses: 'REAL',
      ExchangeRateToINR: 'REAL',
      LotTag: 'REAL',
      IsSTTPaid: 'INTEGER',
      IsTransferIn: 'INTEGER',
      IsLocked: 'INTEGER',
      PurchaseLotID: 'TEXT'
    }
  },
  StockSalesOrTransferOuts: {
    sqlName: 'stock_sales',
    fields: {
      SaleDate: 'TEXT',
      SecurityName: 'TEXT',
      BrokerageName: 'TEXT',
      SaleQuantity: 'REAL',
      SaleAmount: 'REAL',
      SaleExpenses: 'REAL',
      DomesticExpensesINR: 'REAL',
      ExchangeRateToINR: 'REAL',
      IsTransferOut: 'INTEGER',
      Remarks: 'TEXT',
      IsLocked: 'INTEGER'
    }
  }
};

const BOOLEAN_FIELDS = new Set([
  'IsLocked',
  'IsSTTPaid',
  'IsTransferIn',
  'IsTransferOut',
  'NonTaxable'
]);

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  return JSON.parse(value);
}

function openDatabase(dbPath) {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  initializeSchema(db);
  return db;
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS finbook_metadata (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL CHECK(json_valid(value_json))
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY,
      account_code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      enabled_explicit INTEGER NOT NULL DEFAULT 0,
      extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json))
    );
    CREATE TABLE IF NOT EXISTS repo_config (
      category TEXT PRIMARY KEY,
      value_json TEXT NOT NULL CHECK(json_valid(value_json))
    );
    CREATE TABLE IF NOT EXISTS account_profile_entries (
      id INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      position INTEGER NOT NULL,
      value_json TEXT NOT NULL CHECK(json_valid(value_json)),
      UNIQUE(account_id, category, position)
    );
    CREATE INDEX IF NOT EXISTS idx_account_profile_category
      ON account_profile_entries(account_id, category, position);
    CREATE TABLE IF NOT EXISTS account_profile_categories (
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY(account_id, category),
      UNIQUE(account_id, position)
    );
    CREATE TABLE IF NOT EXISTS journal_entries (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id TEXT NOT NULL UNIQUE,
      version INTEGER NOT NULL,
      operation TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
      created_at TEXT NOT NULL,
      meta_json TEXT CHECK(meta_json IS NULL OR json_valid(meta_json))
    );
  `);

  const accountColumns = new Set(db.prepare('PRAGMA table_info(accounts)').all().map((column) => column.name));
  if (!accountColumns.has('enabled_explicit')) {
    db.exec('ALTER TABLE accounts ADD COLUMN enabled_explicit INTEGER NOT NULL DEFAULT 0');
  }

  for (const definition of Object.values(TABLE_DEFINITIONS)) {
    const columns = Object.entries(definition.fields)
      .map(([field, type]) => `${quoteIdentifier(field)} ${type}`)
      .join(',\n      ');
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${quoteIdentifier(definition.sqlName)} (
        id INTEGER PRIMARY KEY,
        row_key TEXT NOT NULL UNIQUE,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        ${columns},
        extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json)),
        UNIQUE(account_id, position)
      );
      CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${definition.sqlName}_account`)}
        ON ${quoteIdentifier(definition.sqlName)}(account_id, position);
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_sale_purchase_lots (
      sale_id INTEGER NOT NULL REFERENCES stock_sales(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      purchase_lot_id TEXT NOT NULL,
      sale_quantity REAL NOT NULL,
      PRIMARY KEY(sale_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_sale_lots_purchase_lot
      ON stock_sale_purchase_lots(purchase_lot_id);
    INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  `);
}

function withDatabase(dbPath, callback) {
  const db = openDatabase(dbPath);
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function stableRowKey(accountCode, tableName, row, position) {
  const dedupKeys = core.DEDUP_KEYS[tableName] || [];
  const identity = dedupKeys.length > 0
    ? dedupKeys.map((key) => row[key] ?? null)
    : row;
  return crypto.createHash('sha256')
    .update(JSON.stringify([accountCode, tableName, identity, position]))
    .digest('hex');
}

function toSqlValue(field, value) {
  if (value === undefined || value === null) return null;
  if (BOOLEAN_FIELDS.has(field)) return value ? 1 : 0;
  return value;
}

function fromSqlValue(field, value) {
  if (value === null || value === undefined) return undefined;
  if (BOOLEAN_FIELDS.has(field)) return value === 1;
  return value;
}

function getPersistedRow(tableName, row) {
  const definition = TABLE_DEFINITIONS[tableName];
  const computed = new Set(core.COMPUTED_FIELDS[tableName] || []);
  const known = new Set(Object.keys(definition.fields));
  const extra = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (!known.has(key) && !computed.has(key) && key !== 'PurchaseLots') {
      extra[key] = value;
    }
  }
  return { definition, extra };
}

function insertDomainRows(db, accountId, accountCode, tableName, rows) {
  const definition = TABLE_DEFINITIONS[tableName];
  const fields = Object.keys(definition.fields);
  const columns = ['row_key', 'account_id', 'position', ...fields, 'extra_json'];
  const placeholders = columns.map(() => '?').join(', ');
  const insert = db.prepare(`
    INSERT INTO ${quoteIdentifier(definition.sqlName)}
      (${columns.map(quoteIdentifier).join(', ')})
    VALUES (${placeholders})
  `);
  const insertLot = tableName === 'StockSalesOrTransferOuts'
    ? db.prepare(`
        INSERT INTO stock_sale_purchase_lots
          (sale_id, position, purchase_lot_id, sale_quantity)
        VALUES (?, ?, ?, ?)
      `)
    : null;

  (rows || []).forEach((row, position) => {
    const { extra } = getPersistedRow(tableName, row);
    const values = [
      stableRowKey(accountCode, tableName, row, position),
      accountId,
      position,
      ...fields.map((field) => toSqlValue(field, row[field])),
      JSON.stringify(extra)
    ];
    const result = insert.run(...values);
    if (insertLot) {
      (row.PurchaseLots || []).forEach((lot, lotPosition) => {
        insertLot.run(result.lastInsertRowid, lotPosition, lot.PurchaseLotID, lot.SaleQuantity);
      });
    }
  });
}

function replaceCommittedState(db, state) {
  db.exec('DELETE FROM stock_sale_purchase_lots');
  for (const definition of Object.values(TABLE_DEFINITIONS)) {
    db.exec(`DELETE FROM ${quoteIdentifier(definition.sqlName)}`);
  }
  db.exec('DELETE FROM account_profile_entries; DELETE FROM account_profile_categories; DELETE FROM accounts; DELETE FROM repo_config; DELETE FROM finbook_metadata;');

  const insertConfig = db.prepare('INSERT INTO repo_config(category, value_json) VALUES (?, ?)');
  for (const [category, value] of Object.entries(state.config || {})) {
    insertConfig.run(category, JSON.stringify(value));
  }

  const system = state._system && typeof state._system === 'object' ? state._system : null;
  if (system) {
    db.prepare('INSERT INTO finbook_metadata(key, value_json) VALUES (?, ?)')
      .run('_system', JSON.stringify(system));
  }

  const insertAccount = db.prepare(`
    INSERT INTO accounts(account_code, name, enabled, enabled_explicit, extra_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertProfileCategory = db.prepare(`
    INSERT INTO account_profile_categories(account_id, category, position)
    VALUES (?, ?, ?)
  `);
  const insertProfile = db.prepare(`
    INSERT INTO account_profile_entries(account_id, category, position, value_json)
    VALUES (?, ?, ?, ?)
  `);

  for (const account of state.accounts || []) {
    const extra = {};
    for (const [key, value] of Object.entries(account)) {
      if (!['account', 'name', 'enabled'].includes(key) && !Array.isArray(value)) {
        extra[key] = value;
      }
    }
    const result = insertAccount.run(
      account.account,
      account.name || account.account,
      account.enabled === false ? 0 : 1,
      Object.prototype.hasOwnProperty.call(account, 'enabled') ? 1 : 0,
      JSON.stringify(extra)
    );
    const accountId = result.lastInsertRowid;

    for (const tableName of core.TABLE_NAMES) {
      if (TABLE_DEFINITIONS[tableName]) {
        insertDomainRows(db, accountId, account.account, tableName, account[tableName] || []);
      }
    }

    let categoryPosition = 0;
    for (const [category, entries] of Object.entries(account)) {
      if (!Array.isArray(entries) || TABLE_DEFINITIONS[category]) continue;
      insertProfileCategory.run(accountId, category, categoryPosition);
      categoryPosition += 1;
      entries.forEach((entry, position) => {
        insertProfile.run(accountId, category, position, JSON.stringify(entry));
      });
    }
  }
}

function readDomainRows(db, accountId, tableName) {
  const definition = TABLE_DEFINITIONS[tableName];
  const fields = Object.keys(definition.fields);
  const rows = db.prepare(`
    SELECT * FROM ${quoteIdentifier(definition.sqlName)}
    WHERE account_id = ?
    ORDER BY position
  `).all(accountId);
  const readLots = tableName === 'StockSalesOrTransferOuts'
    ? db.prepare(`
        SELECT purchase_lot_id, sale_quantity
        FROM stock_sale_purchase_lots
        WHERE sale_id = ?
        ORDER BY position
      `)
    : null;

  return rows.map((stored) => {
    const row = parseJson(stored.extra_json, {});
    for (const field of fields) {
      const value = fromSqlValue(field, stored[field]);
      if (value !== undefined) row[field] = value;
    }
    if (readLots) {
      const lots = readLots.all(stored.id).map((lot) => ({
        PurchaseLotID: lot.purchase_lot_id,
        SaleQuantity: lot.sale_quantity
      }));
      if (lots.length > 0) row.PurchaseLots = lots;
    }
    return row;
  });
}

function loadCommittedState(db) {
  const config = {};
  for (const row of db.prepare('SELECT category, value_json FROM repo_config ORDER BY category').all()) {
    config[row.category] = parseJson(row.value_json, null);
  }

  const state = { config, accounts: [] };
  const system = db.prepare("SELECT value_json FROM finbook_metadata WHERE key = '_system'").get();
  if (system) state._system = parseJson(system.value_json, {});

  const profileQuery = db.prepare(`
    SELECT category, value_json
    FROM account_profile_entries
    WHERE account_id = ?
    ORDER BY category, position
  `);
  const profileCategoryQuery = db.prepare(`
    SELECT category
    FROM account_profile_categories
    WHERE account_id = ?
    ORDER BY position
  `);
  for (const storedAccount of db.prepare('SELECT * FROM accounts ORDER BY id').all()) {
    const account = {
      ...parseJson(storedAccount.extra_json, {}),
      account: storedAccount.account_code,
      name: storedAccount.name
    };
    if (storedAccount.enabled_explicit === 1) account.enabled = storedAccount.enabled === 1;
    for (const tableName of core.TABLE_NAMES) {
      account[tableName] = [];
      if (TABLE_DEFINITIONS[tableName]) {
        account[tableName] = readDomainRows(db, storedAccount.id, tableName);
      }
    }
    for (const profileCategory of profileCategoryQuery.all(storedAccount.id)) {
      account[profileCategory.category] = [];
    }
    for (const profile of profileQuery.all(storedAccount.id)) {
      if (!account[profile.category]) account[profile.category] = [];
      account[profile.category].push(parseJson(profile.value_json, null));
    }
    state.accounts.push(account);
  }
  return state;
}

function loadDb(dbPath) {
  return withDatabase(dbPath, loadCommittedState);
}

function saveDb(dbPath, state) {
  const resolved = path.resolve(dbPath);
  withDatabase(resolved, (db) => db.transaction(() => replaceCommittedState(db, state))());
  return resolved;
}

function loadJournal(dbPath, normalizeEntry) {
  return withDatabase(dbPath, (db) => db.prepare(`
    SELECT entry_id, version, operation, payload_json, created_at, meta_json
    FROM journal_entries
    ORDER BY sequence
  `).all().map((row) => normalizeEntry({
    entryId: row.entry_id,
    version: row.version,
    operation: row.operation,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
    ...(row.meta_json ? { meta: parseJson(row.meta_json, {}) } : {})
  })));
}

function insertJournalEntries(db, entries) {
  const insert = db.prepare(`
    INSERT INTO journal_entries(entry_id, version, operation, payload_json, created_at, meta_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const entry of entries) {
    insert.run(
      entry.entryId,
      entry.version,
      entry.operation,
      JSON.stringify(entry.payload || {}),
      entry.createdAt,
      entry.meta ? JSON.stringify(entry.meta) : null
    );
  }
}

function saveJournal(dbPath, entries) {
  const resolved = path.resolve(dbPath);
  withDatabase(resolved, (db) => {
    db.transaction(() => {
      db.exec('DELETE FROM journal_entries');
      insertJournalEntries(db, entries);
    })();
  });
  return resolved;
}

function appendJournalEntries(dbPath, entries) {
  withDatabase(dbPath, (db) => db.transaction(() => insertJournalEntries(db, entries))());
  return entries;
}

function initializeDatabase(dbPath, state, entries) {
  const resolved = path.resolve(dbPath);
  withDatabase(resolved, (db) => {
    db.transaction(() => {
      replaceCommittedState(db, state);
      db.exec('DELETE FROM journal_entries');
      insertJournalEntries(db, entries);
    })();
  });
  return resolved;
}

module.exports = {
  TABLE_DEFINITIONS,
  openDatabase,
  loadDb,
  saveDb,
  loadJournal,
  saveJournal,
  appendJournalEntries,
  initializeDatabase
};
