/**
 * The worker's early read of a property (Listing Prep P3) on the Desk, against the fake
 * Supabase backend: the value range with its confidence, inputs and disclaimer, buyer
 * needs, nearest schools, amenities, notes and sources; and the empty states. The
 * numbers are the worker's (tests/test_listing_prep_*.py); the page only formats them.
 */
import AxeBuilder from '@axe-core/playwright';
import { fakeBackend, ME, newState, signedIn, type State } from './fakeSupabase';
import { expect, gotoView, test } from './fixtures';

const PID = '00000000-0000-4000-8000-0000000000bb';

function state(withInsights: boolean, confirmed = true): State {
  const s = newState();
  s.teams.push({ id: 't1', name: 'Coastline Realty' });
  s.members.push({ team_id: 't1', user_id: ME.id, role: 'manager', display_name: null, email: ME.email });
  s.tables.properties = [
    {
      id: PID,
      team_id: 't1',
      address: '1 Civic Center Plaza, Irvine, CA 92606',
      zip: '92606',
      city: 'Irvine',
      place_id: '0636770',
      lat: 33.6875,
      lon: -117.8263,
      status: 'preparing',
      facts: { property_type: 'single_family', beds: 3, baths: 2.5, sqft: 2000, year_built: 1978 },
      facts_confirmed_at: confirmed ? '2026-10-01T16:00:00Z' : null,
      created_at: '2026-10-01T15:00:00Z',
    },
  ];
  if (withInsights)
    s.tables.property_insights = [
      {
        property_id: PID,
        valuation: {
          low: 1_070_000,
          mid: 1_260_000,
          high: 1_450_000,
          method: 'zip_ppsf',
          confidence: 'low',
          notes: ['A wide range from area medians: comparable sales from the MLS feed will narrow it.'],
          inputs: { sqft: 2000, ppsf: 650, ppsf_source: 'zip', typical_sqft: 2000, size_adjustment: 1, condition_score: 2, condition_adjustment: 0.97, spread: 0.15 },
        },
        segments: [
          { key: 'more_space', label: 'More space', weight: 0.42, priorities: ['bedroom count and size', 'storage and closets'], evidence: ['30% of households of 4 or more in this ZIP vs 20% in the county'] },
          { key: 'work_from_home', label: 'Work from home', weight: 0.33, priorities: ['a quiet room that works as an office'], evidence: [] },
        ],
        schools: [
          { name: 'Plaza Vista', level: 'elementary', grades: 'K-8', charter: false, miles: 0.6 },
          { name: 'University High', level: 'high', grades: '9-12', charter: false, miles: 2.1 },
        ],
        amenities: [
          { kind: 'grocery', count: 1, nearest_miles: 0.4 },
          { kind: 'rail', count: 0, nearest_miles: null },
        ],
        sources: ['Redfin ZIP and city medians, data through 2026-08-31', '© OpenStreetMap contributors (ODbL)'],
        notes: ['Buyer demand needs the Census key (CENSUS_API_KEY) or the Census service was unavailable.'],
        computed_at: '2026-10-01T16:10:00Z',
      },
    ];
  return s;
}

test('the early read shows the worker’s numbers with confidence, inputs, sources and caveats', async ({ page, consoleErrors }) => {
  await fakeBackend(page, state(true));
  await signedIn(page);
  await gotoView(page, `/desk/property/${PID}`);
  const card = page.getByTestId('desk-insights');
  const value = page.getByTestId('desk-valuation');
  await expect(value).toContainText('Value range · Low confidence');
  await expect(value).toContainText('$1,070,000 – $1,450,000');
  await expect(value).toContainText('Midpoint $1,260,000.');
  await expect(value).toContainText('$650/sq ft (the ZIP’s median) × 2,000 sq ft, × 0.97 for condition, ± 15%.');
  await expect(value).toContainText('not an appraisal');
  await expect(page.getByTestId('desk-segments')).toContainText('More space · 42%');
  await expect(page.getByTestId('desk-segments')).toContainText('30% of households of 4 or more in this ZIP vs 20% in the county');
  await expect(card).toContainText('never who to market to');
  await expect(page.getByTestId('desk-schools')).toContainText('Plaza Vista · Elementary (K-8) · 0.6 mi');
  await expect(card).toContainText('not attendance boundaries');
  await expect(page.getByTestId('desk-amenities')).toContainText('Groceries: 1 · nearest 0.4 mi');
  await expect(page.getByTestId('desk-amenities')).toContainText('Rail stations: 0');
  await expect(page.getByTestId('desk-insights-notes')).toContainText('CENSUS_API_KEY');
  await expect(card).toContainText('OpenStreetMap contributors');
  // The market card shows the published $/sq ft row too.
  await expect(page.getByTestId('desk-market').getByRole('row', { name: /Median \$\/sq ft/ })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('before the worker runs, the card says what happens next', async ({ page }) => {
  await fakeBackend(page, state(false));
  await signedIn(page);
  await gotoView(page, `/desk/property/${PID}`);
  await expect(page.getByTestId('desk-insights-empty')).toHaveText('The worker computes this within about 15 minutes of confirming the facts.');
});

test('without confirmed facts, the card asks for them', async ({ page }) => {
  await fakeBackend(page, state(false, false));
  await signedIn(page);
  await gotoView(page, `/desk/property/${PID}`);
  await expect(page.getByTestId('desk-insights-empty')).toContainText('Confirm the facts to get an early value range');
});
