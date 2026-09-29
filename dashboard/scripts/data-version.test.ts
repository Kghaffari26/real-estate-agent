import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain .mjs build script without types
import { dataVersion } from './data-version.mjs';

function dataDir(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'dv-'));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

describe('dataVersion', () => {
  const base = { 'latest.json': '{"a":1}', 'metros/x.json': '{"b":2}' };
  it('is a stable 12-char hash of the data', () => {
    const v = dataVersion(dataDir(base));
    expect(v).toMatch(/^[0-9a-f]{12}$/);
    expect(dataVersion(dataDir(base))).toBe(v);
  });
  it('changes when any data file changes, but not for source.json', () => {
    const v = dataVersion(dataDir(base));
    expect(dataVersion(dataDir({ ...base, 'latest.json': '{"a":2}' }))).not.toBe(v);
    expect(dataVersion(dataDir({ ...base, 'metros/y.json': '{}' }))).not.toBe(v);
    expect(dataVersion(dataDir({ ...base, 'source.json': '{"fetched_at":"now"}' }))).toBe(v);
  });
  it('falls back to "dev" without data', () => {
    expect(dataVersion(join(tmpdir(), 'does-not-exist-xyz'))).toBe('dev');
  });
});
