#!/usr/bin/env node
// Usage: node scripts/gen-schema.mjs [--check]
// Regenerates src/data/schema.gen.ts from ../schemas/real_estate.schema.json.
// --check exits 1 (without writing) when the committed file is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './gen-schema-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '../../schemas/real_estate.schema.json');
const outPath = resolve(here, '../src/data/schema.gen.ts');

const output = generate(JSON.parse(readFileSync(schemaPath, 'utf8')));

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(outPath, 'utf8');
  } catch {
    // missing file is stale
  }
  if (current !== output) {
    console.error('src/data/schema.gen.ts is stale: run `npm run gen:schema` and commit the result.');
    process.exit(1);
  }
  console.log('src/data/schema.gen.ts is up to date.');
} else {
  writeFileSync(outPath, output);
  console.log(`Wrote ${outPath}`);
}
