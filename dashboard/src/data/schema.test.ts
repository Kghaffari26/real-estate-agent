import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error: plain .mjs build script without types
import { generate } from '../../scripts/gen-schema-lib.mjs';
import { ManifestEntrySchema } from './manifest';
import { IndexOutputSchema, MetroDetailOutputSchema } from './schema.gen';
import { setWarner } from './tolerant';

const root = resolve(__dirname, '../..');
const sample = (path: string) => JSON.parse(readFileSync(resolve(root, 'sample-data', path), 'utf8'));

let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  setWarner((m) => warnings.push(m));
});
afterEach(() => setWarner(null));

describe('generated schema', () => {
  it('is up to date with schemas/real_estate.schema.json', () => {
    const schema = JSON.parse(readFileSync(resolve(root, '../schemas/real_estate.schema.json'), 'utf8'));
    const committed = readFileSync(resolve(root, 'src/data/schema.gen.ts'), 'utf8');
    expect(committed, 'run `npm run gen:schema`').toBe(generate(schema));
  });
});

describe('sample snapshot parses cleanly', () => {
  it('latest.json', () => {
    const index = IndexOutputSchema.parse(sample('latest.json'));
    expect(index.metros).toHaveLength(50);
    expect(index.metric_registry.length).toBeGreaterThan(10);
    expect(warnings).toEqual([]);
  });

  it('every metro file', () => {
    const files = readdirSync(resolve(root, 'sample-data/metros'));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const file of files) {
      const metro = MetroDetailOutputSchema.parse(sample(`metros/${file}`));
      expect(`${metro.slug}.json`).toBe(file);
    }
    expect(warnings).toEqual([]);
  });

  it('keeps permits values (PermitsValue, not MetricValue)', () => {
    const raw = sample('metros/pittsburgh-pa.json');
    raw.latest.permits_total = { value: 120, yoy_12m: 0.12 };
    const metro = MetroDetailOutputSchema.parse(raw);
    expect(metro.latest.permits_total).toEqual({ value: 120, yoy_12m: 0.12 });
    expect(metro.latest.median_sale_price).toMatchObject({ trend_3m: 'up' });
  });

  it('manifest-entry.json', () => {
    const manifest = ManifestEntrySchema.parse(sample('manifest-entry.json'));
    expect(manifest.id).toBe('real_estate');
    expect(manifest.key_stats.length).toBe(2);
  });
});

describe('tolerant parsing', () => {
  it('accepts 1.0.0-era data without the 1.1.0 additive fields', () => {
    const raw = sample('latest.json');
    delete raw.investigations;
    delete raw.meta.warnings;
    raw.alerts.forEach((a: Record<string, unknown>) => delete a.metros);
    const index = IndexOutputSchema.parse(raw);
    expect(index.investigations).toEqual([]);
    expect(index.meta.warnings).toEqual([]);
    expect(index.alerts[0]!.metros).toEqual([]);
    expect(warnings).toEqual([]);

    const metro = sample('metros/pittsburgh-pa.json');
    delete metro.investigation;
    expect(MetroDetailOutputSchema.parse(metro).investigation).toBeNull();
  });

  it('drops a malformed metro with a warning instead of failing', () => {
    const raw = sample('latest.json');
    raw.metros[3] = { slug: 'broken' };
    const index = IndexOutputSchema.parse(raw);
    expect(index.metros).toHaveLength(49);
    expect(warnings.some((w) => w.includes('IndexOutput.metros[3] dropped'))).toBe(true);
  });

  it('drops malformed map entries and replaces malformed optional fields', () => {
    const raw = sample('metros/pittsburgh-pa.json');
    raw.latest.median_dom = 'fast';
    raw.brief.reused = 'maybe';
    raw.series.zhvi[5] = 'n/a';
    const metro = MetroDetailOutputSchema.parse(raw);
    expect(metro.latest.median_dom).toBeUndefined();
    expect(metro.brief.reused).toBe(false);
    expect(metro.series.zhvi![5]).toBeNull();
    expect(warnings.length).toBe(2);
  });

  it('still rejects a file missing a required top-level block', () => {
    const raw = sample('latest.json');
    delete raw.national;
    expect(IndexOutputSchema.safeParse(raw).success).toBe(false);
  });
});
