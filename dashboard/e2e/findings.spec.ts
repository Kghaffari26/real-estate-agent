/**
 * Photo findings (Listing Prep P2) against the fake Supabase backend: reviewing findings
 * (confirm, edit, reject), photo notes for skipped photos, requesting an analysis and
 * what blocks it, a consent under the old text, and a revocation: findings withdrawn
 * and hidden, photos hidden, then a manager deletes them. The worker and the database
 * rules behind these are tested in tests/test_listing_prep*.py and src/backend/*.rls.test.ts.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { fakeBackend, ME, newState, signedIn, type State } from './fakeSupabase';
import { expect, gotoView, test } from './fixtures';

const TEAM = 't1';
const PID = '00000000-0000-4000-8000-0000000000aa';
const CORE = { property_type: 'single_family', beds: 3, baths: 2.5, sqft: 1850, year_built: 1978 };

function png() {
  const p = new PNG({ width: 64, height: 48 });
  for (let i = 0; i < p.data.length; i += 4) p.data.set([190, 160, 130, 255], i);
  return PNG.sync.write(p);
}

function seeded({ version = '2026-10b', analyzed = true }: { version?: string; analyzed?: boolean } = {}): State {
  const s = newState();
  s.teams.push({ id: TEAM, name: 'Coastline Realty' });
  s.members.push({ team_id: TEAM, user_id: ME.id, role: 'manager', display_name: null, email: ME.email });
  s.photoBytes = png();
  s.tables.properties = [{ id: PID, team_id: TEAM, address: '14 Sandpiper, Irvine, CA 92604', zip: '92604', city: 'Irvine', place_id: '0636770', status: 'preparing', facts: CORE, facts_confirmed_at: '2026-10-01T16:00:00Z', created_at: '2026-10-01T15:00:00Z' }];
  s.tables.seller_consents = [{ id: 'c1', property_id: PID, seller_name: 'Pat Seller', method: 'signed_form', consent_version: version, given_on: '2026-09-30', recorded_by: ME.id, revoked_at: null }];
  s.tables.photos = [
    { id: 'ph-k', property_id: PID, room: 'kitchen', storage_path: `${TEAM}/${PID}/k.jpg`, uploaded_by: ME.id, created_at: '2026-10-01T16:01:00Z' },
    { id: 'ph-l', property_id: PID, room: 'living', storage_path: `${TEAM}/${PID}/l.jpg`, uploaded_by: ME.id, created_at: '2026-10-01T16:02:00Z' },
  ];
  if (analyzed) {
    s.tables.vision_jobs = [{ id: 'j1', property_id: PID, status: 'done', photos_total: 2, photos_done: 2, error: null, created_at: '2026-10-01T16:05:00Z', finished_at: '2026-10-01T16:06:00Z' }];
    s.tables.photo_results = [
      { photo_id: 'ph-k', outcome: 'analyzed', note: '1 finding left out by the fair-housing check (condition and fixes only).' },
      { photo_id: 'ph-l', outcome: 'skipped_people', note: 'People are visible in this photo, so it wasn’t analyzed. Retake it with nobody in the frame.' },
    ];
    const f = (id: string, issue: string, fix: string, created: string) => ({
      id,
      property_id: PID,
      photo_id: 'ph-k',
      room: 'kitchen',
      category: 'cabinets',
      condition: 2,
      issue,
      suggested_fix: fix,
      fix_item: 'cabinet_refinish',
      quantity: 18,
      severity: 'cosmetic',
      evidence: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 },
      model_confidence: 'high',
      status: 'proposed',
      agent_note: null,
      reviewed_at: null,
      created_at: created,
    });
    s.tables.findings = [f('f1', 'Cabinet doors are worn at the edges', 'Refinish the cabinet doors', '2026-10-01T16:06:01Z'), f('f2', 'Dated brass pulls on every drawer', 'Replace the hardware', '2026-10-01T16:06:02Z')];
  }
  return s;
}

const serious = (violations: Array<{ id: string; impact?: string | null; nodes: Array<{ target: unknown[] }> }>) =>
  violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(', ')}`);

async function open(page: Page, s: State) {
  await fakeBackend(page, s);
  await signedIn(page);
  await gotoView(page, `/desk/property/${PID}`);
  await expect(page.getByTestId('desk-findings')).toBeVisible();
}

test('an agent reviews the findings: confirm, edit, reject; skipped photos say why', async ({ page, consoleErrors }) => {
  const s = seeded();
  await open(page, s);
  const card = page.getByTestId('desk-findings');
  await expect(page.getByTestId('desk-findings-counts')).toHaveText('2 findings: 2 to review, 0 confirmed, 0 rejected.');
  await expect(page.getByTestId('desk-photo-notes')).toContainText('Living room: People are visible in this photo');
  await expect(page.getByTestId('desk-photo-notes')).toContainText('Kitchen: 1 finding left out by the fair-housing check');
  await expect(page.getByTestId('desk-findings-blocked')).toHaveText('Every photo has been analyzed. Add new photos to analyze them.');
  await expect(page.getByTestId('desk-job')).toContainText('Analyzed');

  await card.getByRole('button', { name: 'Confirm: Cabinet doors are worn at the edges' }).click();
  await expect(card.getByTestId('desk-finding').first()).toHaveAttribute('data-status', 'confirmed');
  await card.getByRole('button', { name: 'Edit: Dated brass pulls on every drawer' }).click();
  await card.getByLabel('What’s wrong').fill('Dated brass pulls on most drawers');
  await card.getByLabel('Condition').selectOption('3');
  await card.getByRole('button', { name: 'Save and confirm' }).click();
  await expect(card.getByTestId('desk-finding').nth(1)).toHaveAttribute('data-status', 'edited');
  expect(s.tables.findings![1]).toMatchObject({ status: 'edited', issue: 'Dated brass pulls on most drawers', condition: 3 });
  await card.getByRole('button', { name: 'Reject: Cabinet doors are worn at the edges' }).click();
  await expect(page.getByTestId('desk-findings-counts')).toHaveText('2 findings: 0 to review, 1 confirmed, 1 rejected.');

  expect(serious((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('requesting an analysis queues a job; what blocks it is stated', async ({ page }) => {
  const s = seeded({ analyzed: false });
  await open(page, s);
  const card = page.getByTestId('desk-findings');
  await card.getByRole('button', { name: 'Analyze photos' }).click();
  await expect(page.getByTestId('desk-job')).toHaveText('Queued. The worker picks up analyses every 15 minutes.');
  expect(s.tables.vision_jobs).toEqual([expect.objectContaining({ property_id: PID, requested_by: ME.id, status: 'queued' })]);
  await expect(card.getByRole('button', { name: 'Analyze photos' })).toBeDisabled();
  await expect(page.getByTestId('desk-findings-blocked')).toHaveText('An analysis is already queued or running.');
});

test('a consent under the old text allows photos but not analysis', async ({ page }) => {
  await open(page, seeded({ version: '2026-10', analyzed: false }));
  await expect(page.getByTestId('desk-consent-outdated')).toContainText('doesn’t cover AI analysis');
  await expect(page.getByTestId('desk-findings-blocked')).toContainText('recorded under text 2026-10');
  await expect(page.getByTestId('desk-findings').getByRole('button', { name: 'Analyze photos' })).toBeDisabled();
});

test('revoking consent hides the photos and withdraws the findings; a manager can delete the photos', async ({ page }) => {
  const s = seeded();
  await open(page, s);
  await expect(page.getByTestId('desk-photo')).toHaveCount(2);
  const consent = page.getByTestId('desk-consent');
  await consent.getByRole('button', { name: 'Record a revocation' }).click();
  await expect(consent).toContainText('The photos will be hidden');
  await consent.getByRole('button', { name: 'Confirm revocation' }).click();

  await expect(page.getByTestId('desk-consent-revoked')).toContainText('photos are hidden');
  await expect(page.getByTestId('desk-photo')).toHaveCount(0);
  await expect(page.getByTestId('desk-findings-withdrawn')).toHaveText('2 findings were withdrawn when the seller revoked consent. They aren’t shown or used.');
  await expect(page.getByTestId('desk-finding')).toHaveCount(0);
  await expect(page.getByTestId('desk-findings')).not.toContainText('Cabinet doors');
  await expect(page.getByTestId('desk-photo-notes')).toHaveCount(0);

  await page.getByRole('button', { name: 'Delete all photos now' }).click();
  await page.getByRole('button', { name: 'Delete all photos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete all photos now' })).toBeVisible();
  expect(s.tables.photos).toEqual([]);
});
