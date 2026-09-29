import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexOutputSchema, MetroDetailOutputSchema } from '../data/schema.gen';
import { changeAt } from '../lib/timeline';
import { dossierChart } from './dossier';

const index = IndexOutputSchema.parse(JSON.parse(readFileSync('sample-data/latest.json', 'utf8')));
const austin = MetroDetailOutputSchema.parse(JSON.parse(readFileSync('sample-data/metros/austin-tx.json', 'utf8')));
const tl = JSON.parse(readFileSync('sample-data/timeline/median_sale_price.json', 'utf8'));
const price = index.metric_registry.find((r) => r.key === 'median_sale_price')!;
const base = { detail: austin, metric: price, national: index.national.series, timeline: null };

describe('dossier chart', () => {
  it('slices the metro file by range', () => {
    const y1 = dossierChart({ ...base, range: '1Y', mode: 'level', indexed: false });
    expect(y1.dates).toHaveLength(12);
    expect(y1.metro.at(-1)).toBe(austin.latest.median_sale_price!.value);
    expect(dossierChart({ ...base, range: '3Y', mode: 'level', indexed: false }).dates).toHaveLength(36);
    // "All" without a loaded timeline stays on the metro file's 36 months.
    expect(dossierChart({ ...base, range: 'All', mode: 'level', indexed: false }).span).toBe('metro-file');
  });

  it('"All" reaches back to 2012 with the §6.4 timeline', () => {
    const all = dossierChart({ ...base, timeline: tl, range: 'All', mode: 'level', indexed: false });
    expect(all.span).toBe('timeline');
    expect(all.dates[0]).toBe('2012-01-31');
    expect(all.metro).toEqual(tl.metros['austin-tx']);
  });

  it('YoY is derived from levels, with the published change for the latest month', () => {
    const yoy = dossierChart({ ...base, timeline: tl, range: 'All', mode: 'yoy', indexed: false });
    const s = tl.metros['austin-tx'];
    expect(yoy.metro[0]).toBeNull(); // Jan 2012: no year-ago value
    expect(yoy.metro[12]).toBeCloseTo(changeAt(s, 12, 'ratio')!, 12);
    const pub = austin.latest.median_sale_price!;
    expect(yoy.metro.at(-1)).toBe('yoy' in pub ? pub.yoy : null);
    expect(yoy.canIndex).toBe(false);
  });

  it('indexes metro and U.S. to 100 on the metro-file range', () => {
    const idx = dossierChart({ ...base, range: '3Y', mode: 'level', indexed: true });
    expect(idx.canIndex).toBe(true);
    expect(idx.metro[0]).toBe(100);
    expect(idx.national![0]).toBe(100);
    // Not possible over the 2012 timeline: the national series is 36 months.
    expect(dossierChart({ ...base, timeline: tl, range: 'All', mode: 'level', indexed: true }).canIndex).toBe(false);
  });
});
