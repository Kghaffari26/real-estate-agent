import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RegionOutputSchema } from '../data/schema.gen';
import vectors from '../backend/fixtures/facts-vectors.json';
import { analysisReadiness, factsFromForm, findingCounts, formatDollars, factsProblems, fitWithin, formFromFacts, marketContext, missingCore, missingRooms, parseCostBook, parseCsvRecords } from './intake';

describe('facts', () => {
  it('agree with the database’s valid_facts on the shared vectors', () => {
    for (const good of vectors.valid) expect(factsProblems(good), JSON.stringify(good)).toEqual({});
    for (const bad of vectors.invalid) expect(Object.keys(factsProblems(bad)), JSON.stringify(bad)).toHaveLength(1);
  });

  it('round-trip through the form; blanks drop out; money accepts $ and commas', () => {
    const facts = factsFromForm({ beds: '3', baths: '2.5', sqft: '1,850', year_built: '1978', property_type: 'single_family', pool: 'no', last_sale_price: '$812,000', lot_sqft: '' });
    expect(facts).toEqual({ beds: 3, baths: 2.5, sqft: 1850, year_built: 1978, property_type: 'single_family', pool: false, last_sale_price: 812000 });
    expect(factsFromForm(formFromFacts(facts))).toEqual(facts);
    expect(factsProblems(factsFromForm({ beds: 'three' }))).toEqual({ beds: 'Bedrooms must be a number' });
    expect(missingCore({ beds: 3, sqft: 1850 })).toEqual(['baths', 'year_built', 'property_type']);
  });
});

describe('the cost book CSV', () => {
  it('reads the committed template: every item, unpriced until the team fills it, notes with commas intact', () => {
    const text = readFileSync(resolve(__dirname, '../../../docs/templates/cost_book.csv'), 'utf8');
    const { rows, problems } = parseCostBook(text);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(34);
    expect(rows[0]).toEqual({ item: 'interior_paint_walls', category: 'paint', unit: 'sq_ft_floor_area', low_usd: null, high_usd: null, notes: 'Walls only, two coats, includes minor patching' });
    expect(rows.every((r) => r.low_usd === null)).toBe(true);
  });

  it('keeps good rows and reports each bad one by line', () => {
    const { rows, problems } = parseCostBook(
      ['item,category,unit,low_usd,high_usd,notes', 'flooring_lvp,flooring,sq_ft,$4.50,"$7.25",', 'flooring_lvp,flooring,sq_ft,1,2,', 'Bad Item,paint,each,1,2,', 'x_ok,paint,acre,1,2,', 'y_ok,paint,each,5,,', 'z_ok,paint,each,9,3,'].join('\n'),
    );
    expect(rows).toEqual([{ item: 'flooring_lvp', category: 'flooring', unit: 'sq_ft', low_usd: 4.5, high_usd: 7.25, notes: null }]);
    expect(problems).toEqual([
      'Line 3 (flooring_lvp): listed twice',
      'Line 4 (bad item): item must be 2–60 lowercase letters, digits or _',
      expect.stringMatching(/^Line 5 \(x_ok\): unit must be one of/),
      'Line 6 (y_ok): give both low_usd and high_usd, or neither',
      'Line 7 (z_ok): high_usd is below low_usd',
    ]);
    expect(parseCostBook('name,price\nx,1').problems[0]).toMatch(/missing columns item, category, unit, low_usd, high_usd/);
  });

  it('parses RFC 4180 quoting, CRLF and a BOM', () => {
    expect(parseCsvRecords(String.fromCharCode(0xfeff) + 'a,"b, c","say ""hi"""\r\n\r\n1,"multi\nline",3\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', 'multi\nline', '3'],
    ]);
  });
});

it('formats dollars with cents only when there are cents', () => {
  expect([formatDollars(4.5), formatDollars(1200), formatDollars(812000), formatDollars(null)]).toEqual(['$4.50', '$1,200', '$812,000', '—']);
});

describe('photos', () => {
  it('asks for the rooms the facts imply', () => {
    expect(missingRooms({ beds: 3, baths: 2, garage_spaces: 2, property_type: 'single_family' }, ['kitchen', 'exterior_front'])).toEqual(['living', 'primary_bedroom', 'primary_bath', 'bedroom', 'bath', 'garage', 'exterior_back']);
    expect(missingRooms({ beds: 1, baths: 1, property_type: 'condo' }, ['exterior_front', 'kitchen', 'living', 'primary_bedroom', 'primary_bath'])).toEqual([]);
  });

  it('fits images inside 2048 px without upscaling', () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });
});

describe('market context', () => {
  it('finds the ZIP and city an address belongs to in the published region', () => {
    const region = RegionOutputSchema.parse(JSON.parse(readFileSync(resolve(__dirname, '../../sample-data/regions/orange-county.json'), 'utf8')));
    const ctx = marketContext(region, '92606', '0636770');
    expect(ctx.zip?.id).toBe('92606');
    expect(ctx.city?.name).toBe('Irvine');
    expect(ctx.zipPriceRank?.of).toBe(region.zips.filter((z) => !z.low_sample && z.latest.median_sale_price?.value != null).length);
    // No place id (an unmatched address with a typed ZIP): the ZIP's own city.
    expect(marketContext(region, '92606', null).city?.name).toBe('Irvine');
    expect(marketContext(region, '00000', null)).toEqual({ zip: null, city: null, zipPriceRank: null });
  });
});

describe('photo findings', () => {
  const base = { factsConfirmed: true, consent: { version: '2026-10b' }, processingVersions: ['2026-10b'], photos: 3, pendingPhotos: 3, jobActive: false };
  it('says what to do before an analysis can run, in the order the database checks', () => {
    expect(analysisReadiness(base)).toEqual({ ok: true });
    expect(analysisReadiness({ ...base, jobActive: true })).toMatchObject({ ok: false, reason: expect.stringMatching(/already queued/) });
    expect(analysisReadiness({ ...base, factsConfirmed: false })).toMatchObject({ reason: 'Confirm the facts first.' });
    expect(analysisReadiness({ ...base, consent: null })).toMatchObject({ reason: 'Record the seller’s consent first.' });
    expect(analysisReadiness({ ...base, consent: { version: '2026-10' } })).toMatchObject({ reason: expect.stringMatching(/2026-10, which doesn’t cover AI analysis/) });
    expect(analysisReadiness({ ...base, photos: 0, pendingPhotos: 0 })).toMatchObject({ reason: 'Add photos first.' });
    expect(analysisReadiness({ ...base, pendingPhotos: 0 })).toMatchObject({ reason: expect.stringMatching(/Every photo/) });
  });

  it('counts findings by status', () => {
    expect(findingCounts([{ status: 'proposed' }, { status: 'confirmed' }, { status: 'confirmed' }, { status: 'withdrawn' }])).toEqual({ proposed: 1, confirmed: 2, edited: 0, rejected: 0, withdrawn: 1 });
  });
});
