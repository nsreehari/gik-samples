#!/usr/bin/env node
'use strict';

const path = require('path');
const api = require('../lib/finbook-api.js');
const { writeManagedTruthsetsManifests } = require('../lib/finbook-mcp-manifests.js');

const outputDir = path.resolve(__dirname, '..');
const dbPath = path.join(outputDir, 'DB', 'finbook.sqlite');
const hydrationResult = api.ensureRuntimeFilesFromSamples(dbPath);
const result = writeManagedTruthsetsManifests(outputDir);
const files = [
  result.semanticPath,
  result.executablePath,
  result.capabilitiesPath,
  result.computedViewsPath,
  result.schemaPath,
].map((filePath) => path.basename(filePath));

if (hydrationResult.dbCreated || hydrationResult.journalCreated) {
  const hydrated = [];
  if (hydrationResult.dbCreated) hydrated.push(path.basename(hydrationResult.dbPath));
  const source = hydrationResult.importedFrom
    ? path.basename(hydrationResult.importedFrom)
    : 'an empty database';
  process.stdout.write(`Hydrated ${hydrated.join(', ')} from ${source} in ${path.dirname(hydrationResult.dbPath)}\n`);
}

process.stdout.write(`Generated ${files.join(', ')} in ${outputDir}\n`);