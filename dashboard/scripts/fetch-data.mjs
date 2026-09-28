#!/usr/bin/env node
/**
 * npm run fetch-data: fill public/data/ with the files the dashboard reads.
 *
 * Order of preference:
 *   1. RE_DATA_DIR=<dir> (or --from <dir>): a local publish dir, e.g. ../public-data
 *      after `uv run agents-run real_estate`. Recorded as source "local".
 *   2. The repo's `data` branch (agents-core's data-branch contract), fetched into
 *      FETCH_HEAD without touching your branches. Recorded as source "data-branch".
 *   3. The committed snapshot in sample-data/. Recorded as source "sample", which
 *      shows the "Sample data" badge.
 *
 * --if-missing skips everything when public/data/latest.json already exists (the
 * predev/prebuild hooks use it, so an explicit fetch isn't overwritten).
 *
 * Copies latest.json, manifest-entry.json, metros/*.json and history/*.json, and
 * writes public/data/source.json. Set RE_DATA_BRANCH / RE_DATA_REMOTE to override
 * the branch (default "data") and remote (default "origin").
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dashboard = resolve(here, '..');
const repoRoot = resolve(dashboard, '..');
const out = resolve(dashboard, 'public/data');
const sampleDir = resolve(dashboard, 'sample-data');
const FILES = ['latest.json', 'manifest-entry.json'];
const DIRS = ['metros', 'history'];

function log(message) {
  console.log(`[fetch-data] ${message}`);
}

/** Copy the contract files from `src` into public/data; false if latest.json is missing. */
function copyFrom(src) {
  if (!existsSync(join(src, 'latest.json'))) return false;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const file of FILES) {
    if (existsSync(join(src, file))) cpSync(join(src, file), join(out, file));
  }
  for (const dir of DIRS) {
    const from = join(src, dir);
    if (!existsSync(from)) continue;
    mkdirSync(join(out, dir), { recursive: true });
    for (const name of readdirSync(from).filter((n) => n.endsWith('.json'))) {
      cpSync(join(from, name), join(out, dir, name));
    }
  }
  return true;
}

function writeSource(source, detail) {
  writeFileSync(
    join(out, 'source.json'),
    JSON.stringify({ source, fetched_at: new Date().toISOString(), detail }, null, 2) + '\n',
  );
  const metros = existsSync(join(out, 'metros')) ? readdirSync(join(out, 'metros')).length : 0;
  log(`${source}: ${detail} → public/data (${metros} metro files)`);
}

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

function fromDataBranch() {
  const remote = process.env.RE_DATA_REMOTE ?? 'origin';
  const branch = process.env.RE_DATA_BRANCH ?? 'data';
  try {
    git(['fetch', '--quiet', '--depth', '1', remote, `refs/heads/${branch}`], { timeout: 60_000 });
  } catch (error) {
    const reason = String(error.stderr ?? error.message).trim().split('\n').pop();
    log(`no ${remote}/${branch} branch (${reason || 'fetch failed'})`);
    return false;
  }
  const tmp = mkdtempSync(join(tmpdir(), 're-data-'));
  try {
    const listed = git(['ls-tree', '--name-only', 'FETCH_HEAD']).toString().split('\n').filter(Boolean);
    const wanted = [...FILES, ...DIRS].filter((p) => listed.includes(p));
    if (!wanted.includes('latest.json')) {
      log(`${remote}/${branch} has no latest.json`);
      return false;
    }
    const tar = git(['archive', '--format=tar', 'FETCH_HEAD', ...wanted], { maxBuffer: 256 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', tmp], { input: tar });
    if (!copyFrom(tmp)) return false;
    const sha = git(['rev-parse', '--short', 'FETCH_HEAD']).toString().trim();
    writeSource('data-branch', `${remote}/${branch}@${sha}`);
    return true;
  } catch (error) {
    log(`couldn't read ${remote}/${branch}: ${error.message}`);
    return false;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  // --if-missing (used by predev/prebuild): keep whatever fetch-data already wrote.
  if (process.argv.includes('--if-missing') && existsSync(join(out, 'latest.json'))) {
    log('public/data already present; run `npm run fetch-data` to refresh');
    return;
  }
  const fromIndex = process.argv.indexOf('--from');
  const localDir = fromIndex > -1 ? process.argv[fromIndex + 1] : process.env.RE_DATA_DIR;
  if (localDir) {
    const dir = resolve(process.cwd(), localDir);
    if (!copyFrom(dir)) {
      console.error(`[fetch-data] ${dir} has no latest.json`);
      process.exit(1);
    }
    writeSource('local', dir);
    return;
  }
  if (fromDataBranch()) return;
  if (!copyFrom(sampleDir)) {
    console.error('[fetch-data] sample-data/ has no latest.json');
    process.exit(1);
  }
  writeSource('sample', 'committed snapshot in dashboard/sample-data/');
}

main();
