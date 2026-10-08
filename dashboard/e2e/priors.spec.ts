/**
 * The team's value priors (Listing Prep P4) on the Desk, against the fake Supabase
 * backend: a manager imports the CSV (each prior with its source; blanks left without
 * one; bad lines reported), an agent only reads. Access rules: src/backend/*.rls.test.ts.
 */
import AxeBuilder from '@axe-core/playwright';
import { fakeBackend, ME, newState, signedIn, type State } from './fakeSupabase';
import { expect, gotoView, test } from './fixtures';

function state(role: 'manager' | 'agent'): State {
  const s = newState();
  s.teams.push({ id: 't1', name: 'Coastline Realty' });
  s.members.push({ team_id: 't1', user_id: ME.id, role, display_name: null, email: ME.email });
  return s;
}

test('a manager imports value priors with their sources', async ({ page }) => {
  const s = state('manager');
  await fakeBackend(page, s);
  await signedIn(page);
  await gotoView(page, '/desk?tab=cost-book');
  const card = page.getByTestId('desk-value-priors');
  await expect(card).toContainText('No priors yet');
  await expect(card).toContainText('can’t be built into software without a license');
  const csv = [
    'item,recovery_low,recovery_high,source,notes',
    'interior_paint_walls,1.1,1.8,Team listings 2024–2026,',
    'flooring_lvp,105%,140%,"Brokerage review, 2025",',
    'staging_full,,,,',
    'window_replace,0.6,0.85,,',
  ].join('\n');
  await page.getByTestId('value-priors-file').setInputFiles({ name: 'value_priors.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('value-priors-notice')).toHaveText('Imported 2 priors; 1 blank item left without one; 1 line skipped.');
  await expect(page.getByTestId('value-priors-problems')).toContainText('Line 5 (window_replace): name the source');
  const list = page.getByTestId('value-priors-list');
  await expect(list).toContainText('interior paint walls');
  await expect(list).toContainText('110%–180% recovered');
  await expect(list).toContainText('Source: Brokerage review, 2025');
  expect(s.tables.value_priors!.map((r) => [r.item, r.recovery_low, r.recovery_high, r.updated_by])).toEqual([
    ['interior_paint_walls', 1.1, 1.8, ME.id],
    ['flooring_lvp', 1.05, 1.4, ME.id],
  ]);
  expect((await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
});

test('an agent reads the priors but can’t import', async ({ page }) => {
  const s = state('agent');
  s.tables.value_priors = [{ team_id: 't1', item: 'professional_cleaning', recovery_low: 1.2, recovery_high: 2.5, source: 'Team listings', notes: null }];
  await fakeBackend(page, s);
  await signedIn(page);
  await gotoView(page, '/desk?tab=cost-book');
  const card = page.getByTestId('desk-value-priors');
  await expect(card).toContainText('120%–250% recovered');
  await expect(card.getByRole('button', { name: 'Import CSV' })).toHaveCount(0);
});
