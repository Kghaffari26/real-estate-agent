/**
 * The listing-prep report card (Listing Prep P5) against the fake Supabase backend:
 * requesting a report, one at a time, cancelling a queued one, and the notice a report in
 * plain template wording shows, with the worker's reason, at the top of the card.
 */
import AxeBuilder from '@axe-core/playwright';
import { fakeBackend, ME, newState, signedIn, type State } from './fakeSupabase';
import { expect, gotoView, test } from './fixtures';

const PID = '00000000-0000-4000-8000-0000000000cc';
const NOTE =
  'Plain wording: the fair-housing review of the written narrative couldn’t run (the AI service returned an error), so this report uses fixed template text instead. The figures are the same either way. Request the report again for the full written narrative.';

function state(confirmed = true): State {
  const s = newState();
  s.teams.push({ id: 't1', name: 'Coastline Realty' });
  s.members.push({ team_id: 't1', user_id: ME.id, role: 'agent', display_name: null, email: ME.email });
  s.tables.properties = [
    {
      id: PID,
      team_id: 't1',
      address: '1 Civic Center Plaza, Irvine, CA 92606',
      zip: '92606',
      city: 'Irvine',
      status: 'preparing',
      facts: { property_type: 'single_family', beds: 3, baths: 2.5, sqft: 2000, year_built: 1978 },
      facts_confirmed_at: confirmed ? '2026-10-01T16:00:00Z' : null,
      created_at: '2026-10-01T15:00:00Z',
    },
  ];
  return s;
}

test('an agent requests a report, sees it queued, and can cancel it', async ({ page, consoleErrors }) => {
  const s = state();
  await fakeBackend(page, s);
  await signedIn(page);
  await gotoView(page, `/desk/property/${PID}`);
  const card = page.getByTestId('desk-report');
  await card.getByLabel('Target price ($, optional)').fill('1,450,000');
  await card.getByLabel('Preparation budget ($, optional)').fill('$25,000');
  await card.getByLabel('Days until listing (optional)').fill('30');
  await card.getByRole('button', { name: 'Request a report' }).click();
  await expect(page.getByTestId('desk-report-status')).toContainText('Version 1: Queued');
  expect(s.tables.reports).toMatchObject([{ property_id: PID, target_price: 1_450_000, budget: 25_000, days_to_list: 30 }]);
  await expect(card.getByRole('button', { name: 'Request a new version' })).toBeDisabled();
  await card.getByRole('button', { name: 'Cancel the request' }).click();
  await expect(page.getByTestId('desk-report-status')).toHaveText('Version 1: The report was cancelled because someone on the team cancelled it.');
  await expect(card.getByRole('button', { name: 'Request a new version' })).toBeEnabled();
  expect(consoleErrors).toEqual([]);
});

test('a report in plain template wording says so, and why, where the agent sees it', async ({ page, consoleErrors }) => {
  const s = state();
  s.tables.reports = [
    { id: 'r1', property_id: PID, version: 2, status: 'done', target_price: 1_450_000, budget: 25_000, days_to_list: 30, narrative_source: 'template', note: NOTE, error: null, requested_at: '2026-10-07T15:00:00Z', finished_at: '2026-10-07T15:06:00Z' },
  ];
  await fakeBackend(page, s);
  await signedIn(page);
  await gotoView(page, `/desk/property/${PID}`);
  const notice = page.getByTestId('desk-report-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('role', 'note');
  await expect(notice).toContainText('Plain wording.');
  await expect(notice).toContainText('the fair-housing review of the written narrative couldn’t run (the AI service returned an error)');
  await expect(notice).toContainText('Request the report again');
  await expect(page.getByTestId('desk-report-status')).toContainText('Version 2: Ready');
  await expect(page.getByTestId('desk-report-status')).toContainText('in plain template wording');
  expect((await new AxeBuilder({ page }).include('[data-testid="desk-report"]').analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('a report with a written narrative shows no notice; without confirmed facts the request waits', async ({ page }) => {
  const s = state(false);
  s.tables.reports = [
    { id: 'r1', property_id: PID, version: 1, status: 'done', target_price: null, budget: null, days_to_list: null, narrative_source: 'llm', note: null, error: null, requested_at: '2026-10-07T15:00:00Z', finished_at: '2026-10-07T15:06:00Z' },
  ];
  await fakeBackend(page, s);
  await signedIn(page);
  await gotoView(page, `/desk/property/${PID}`);
  await expect(page.getByTestId('desk-report-status')).toContainText('with a written narrative');
  await expect(page.getByTestId('desk-report-notice')).toHaveCount(0);
  await expect(page.getByTestId('desk-report').getByRole('button', { name: 'Request a new version' })).toBeDisabled();
  await expect(page.getByTestId('desk-report')).toContainText('Confirm the facts first.');
});
