/**
 * Listing Prep intake (P1) against the fake Supabase backend (e2e/fakeSupabase.ts):
 * adding a property by address (and without a Census match), the market around it,
 * facts saved → confirmed → un-confirmed by an edit, consent before photos, a photo
 * resized to JPEG and uploaded to the property's folder, quotes, and the cost book's
 * CSV import and editing. Access rules are the database's (src/backend/*.rls.test.ts).
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { fakeBackend, ME, newState, signedIn, type State } from './fakeSupabase';
import { expect, expectNoHorizontalScroll, gotoView, test } from './fixtures';

const TEAM = 't1';
const IRVINE = {
  matchedAddress: '1 CIVIC CENTER PLZ, IRVINE, CA, 92606',
  lat: 33.6875,
  lon: -117.8263,
  zip: '92606',
  city: 'Irvine',
  state: 'CA',
  tract: '06059052521',
  countyFips: '06059',
  placeId: '0636770',
  placeName: 'Irvine',
};

function photo(width = 640, height = 480): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([180, 150, 120, 255], i);
  return PNG.sync.write(png);
}

function teamState(role: 'manager' | 'agent' = 'manager'): State {
  const s = newState();
  s.teams.push({ id: TEAM, name: 'Coastline Realty' });
  s.members.push({ team_id: TEAM, user_id: ME.id, role, display_name: null, email: ME.email });
  s.photoBytes = photo(64, 48);
  return s;
}

const serious = (violations: Array<{ id: string; impact?: string | null; nodes: Array<{ target: unknown[] }> }>) =>
  violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(', ')}`);

async function addIrvine(page: Page, s: State) {
  s.geocode = [IRVINE];
  await gotoView(page, '/desk');
  await page.getByRole('button', { name: 'Add a property' }).click();
  await page.getByLabel('Street address').fill('1 Civic Center Plaza, Irvine, CA');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByTestId('desk-matches')).toContainText('1 CIVIC CENTER PLZ, IRVINE, CA, 92606');
  await expect(page.getByTestId('desk-matches')).toContainText('Orange County');
  await page.getByRole('button', { name: 'Add this property' }).click();
  await expect(page).toHaveURL(/#\/desk\/property\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1 Civic Center Plaza, Irvine, CA');
}

test('an agent adds a property by address, confirms its facts, records consent and adds a room photo', async ({ page, consoleErrors }) => {
  const s = teamState();
  s.tables.cost_book = [{ team_id: TEAM, item: 'interior_paint_walls', category: 'paint', unit: 'sq_ft_floor_area', low_usd: 2.5, high_usd: 4.5, notes: null }];
  await fakeBackend(page, s);
  await signedIn(page);
  await addIrvine(page, s);
  expect(s.geocodeCalls).toEqual(['1 Civic Center Plaza, Irvine, CA']);
  expect(s.tables.properties![0]).toMatchObject({ team_id: TEAM, created_by: ME.id, zip: '92606', city: 'Irvine', place_id: '0636770', tract: '06059052521', county_fips: '06059' });

  // The market around it: the published ZIP and city, and a way into the atlas.
  const market = page.getByTestId('desk-market');
  await expect(market.getByRole('columnheader', { name: 'ZIP 92606' })).toBeVisible();
  await expect(market.getByRole('columnheader', { name: 'Irvine' })).toBeVisible();
  await expect(market.getByRole('row', { name: /Median sale price/ })).toContainText('$');
  await expect(market.getByRole('link', { name: 'Open in the atlas' })).toHaveAttribute('href', '#/explore?region=orange-county&city=0636770&zip=92606');

  // Facts: nothing is confirmed until the core facts are saved; an edit un-confirms.
  const facts = page.getByTestId('desk-facts');
  await expect(facts.getByRole('button', { name: 'Confirm facts' })).toBeDisabled();
  await facts.getByLabel(/Property type/).selectOption('single_family');
  await facts.getByLabel(/Bedrooms/).fill('3');
  await facts.getByLabel(/Bathrooms/).fill('2.3');
  await expect(facts.getByRole('alert')).toHaveText('Bathrooms counts in quarters (2, 2.5, 2.75…)');
  await expect(facts.getByRole('button', { name: 'Save facts' })).toBeDisabled();
  await facts.getByLabel(/Bathrooms/).fill('2.5');
  await facts.getByLabel(/Living area/).fill('1,850');
  await facts.getByLabel(/Year built/).fill('1978');
  await facts.getByRole('button', { name: 'Save facts' }).click();
  await expect(facts.getByRole('button', { name: 'Confirm facts' })).toBeEnabled();
  expect(s.tables.properties![0]!.facts).toEqual({ property_type: 'single_family', beds: 3, baths: 2.5, sqft: 1850, year_built: 1978 });
  await facts.getByRole('button', { name: 'Confirm facts' }).click();
  await expect(page.getByTestId('desk-facts-status')).toContainText('Confirmed');
  await facts.getByLabel(/Living area/).fill('1900');
  await facts.getByRole('button', { name: 'Save facts' }).click();
  await expect(page.getByTestId('desk-facts-status')).toContainText('Not confirmed yet');

  // Photos wait for the seller's consent.
  const photos = page.getByTestId('desk-photos');
  await expect(photos).toContainText('Record the seller’s consent above to add photos.');
  await expect(page.getByTestId('desk-photo-coverage')).toContainText('Kitchen');
  const consent = page.getByTestId('desk-consent');
  await consent.getByLabel('Seller’s name').fill('Pat Seller');
  await consent.getByRole('button', { name: 'Record consent' }).click();
  await expect(page.getByTestId('desk-consent-active')).toContainText('Given by Pat Seller (signed form');
  expect(s.tables.seller_consents![0]).toMatchObject({ seller_name: 'Pat Seller', method: 'signed_form', consent_version: '2026-10b', recorded_by: ME.id });

  // A 4000 px PNG goes up as a ≤2048 px JPEG under <team>/<property>/.
  await photos.getByLabel('Room').selectOption('kitchen');
  await page.getByTestId('photo-file').setInputFiles({ name: 'kitchen.png', mimeType: 'image/png', buffer: photo(4000, 3000) });
  await expect(photos.getByRole('img', { name: 'Kitchen photo 1' })).toBeVisible();
  const [key, body] = [...s.files][0]!;
  const propertyId = s.tables.properties![0]!.id as string;
  expect(key).toMatch(new RegExp(`^${TEAM}/${propertyId}/[0-9a-f-]{36}\\.jpg$`));
  expect(body.includes(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true); // JPEG, re-encoded on the device
  expect(s.tables.photos![0]).toMatchObject({ room: 'kitchen', storage_path: key, mime: 'image/jpeg', width: 2048, height: 1536, uploaded_by: ME.id });
  await expect(page.getByTestId('desk-photo-coverage')).not.toContainText('Kitchen');
  await photos.getByLabel('Room for kitchen photo 1').selectOption('dining');
  await expect(photos.getByRole('img', { name: 'Dining photo 1' })).toBeVisible();
  await photos.getByRole('button', { name: 'Delete dining photo 1' }).click();
  await expect(page.getByTestId('desk-photo')).toHaveCount(0);
  expect(s.files.size).toBe(0);

  // A quote overrides the cost book for its item.
  const quotes = page.getByTestId('desk-quotes');
  await quotes.getByLabel('Item').fill('interior_paint_walls');
  await quotes.getByLabel('Low ($)').fill('6,400');
  await quotes.getByLabel('High ($)').fill('7200');
  await quotes.getByLabel('Contractor').fill('Brightline Painting');
  await quotes.getByRole('button', { name: 'Add quote' }).click();
  await expect(page.getByTestId('desk-quote-list')).toContainText('interior paint walls$6,400–$7,200');
  await expect(page.getByTestId('desk-quote-list')).toContainText('Brightline Painting · overrides the cost book');

  await expectNoHorizontalScroll(page);
  expect(serious((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
  expect(consoleErrors).toEqual([]);

  // Back on the list, the property shows its state.
  await page.getByRole('link', { name: 'Properties' }).click();
  await expect(page.getByTestId('desk-properties')).toContainText('1 Civic Center Plaza, Irvine, CA');
  await expect(page.getByTestId('desk-properties')).toContainText('Facts to confirm');
});

test('an address the Census Bureau can’t find is added by ZIP, without a pin', async ({ page }) => {
  const s = teamState();
  await fakeBackend(page, s);
  await signedIn(page);
  await gotoView(page, '/desk');
  await page.getByRole('button', { name: 'Add a property' }).click();
  await page.getByLabel('Street address').fill('27702 Crown Valley Pkwy, Ladera Ranch');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByTestId('desk-no-match')).toContainText('doesn’t have this one');
  await page.getByLabel('ZIP code').fill('92694');
  await page.getByRole('button', { name: 'Add without a pin' }).click();
  await expect(page.getByTestId('desk-property')).toContainText('no map pin');
  expect(s.tables.properties![0]).toMatchObject({ zip: '92694', lat: null, place_id: null });
  // A lookup outage says so and offers the same way forward.
  s.geocode = 'fail';
  await gotoView(page, '/desk');
  await page.getByRole('button', { name: 'Add a property' }).click();
  await page.getByLabel('Street address').fill('1 Civic Center Plaza, Irvine');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByTestId('desk-add-property').getByRole('alert')).toContainText('isn’t answering');
  await expect(page.getByLabel('ZIP code')).toBeVisible();
});

test('a manager imports and edits the cost book; an agent only reads it', async ({ page }) => {
  const s = teamState();
  await fakeBackend(page, s);
  await signedIn(page);
  await gotoView(page, '/desk?tab=cost-book');
  const book = page.getByTestId('desk-cost-book');
  await expect(book).toContainText('The cost book is empty');
  const csv = ['item,category,unit,low_usd,high_usd,notes', 'interior_paint_walls,paint,sq_ft_floor_area,2.50,4.50,"Walls only, two coats"', 'flooring_lvp,flooring,sq_ft,,,', 'bad item,paint,each,1,2,'].join('\n');
  await page.getByTestId('cost-book-file').setInputFiles({ name: 'cost_book.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('cost-book-notice')).toHaveText('Imported 2 items; 1 line skipped.');
  await expect(page.getByTestId('cost-book-problems')).toContainText('Line 4 (bad item)');
  await expect(book).toContainText('1 of 2 items priced.');
  await expect(book.getByRole('row', { name: /interior paint walls/ })).toContainText('$2.50');
  expect(s.tables.cost_book!.map((r) => [r.team_id, r.item, r.low_usd, r.updated_by])).toEqual([
    [TEAM, 'interior_paint_walls', 2.5, ME.id],
    [TEAM, 'flooring_lvp', null, ME.id],
  ]);
  await book.getByRole('button', { name: 'Edit flooring lvp' }).click();
  await book.getByLabel('Low price for flooring lvp').fill('4.25');
  await expect(book.getByTestId('cost-book-edit').getByRole('alert')).toHaveText('Enter both prices, or neither.');
  await book.getByLabel('High price for flooring lvp').fill('7');
  await book.getByRole('button', { name: 'Save' }).click();
  await expect(book.getByRole('row', { name: /flooring lvp/ })).toContainText('$4.25');
  await expect(book).toContainText('2 of 2 items priced.');
  expect(serious((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
});

test('agents read the cost book but can’t change it', async ({ page }) => {
  const s = teamState('agent');
  s.tables.cost_book = [{ team_id: TEAM, item: 'staging_full', category: 'staging', unit: 'month', low_usd: 2500, high_usd: 4000, notes: null }];
  await fakeBackend(page, s);
  await signedIn(page);
  await gotoView(page, '/desk?tab=cost-book');
  const book = page.getByTestId('desk-cost-book');
  await expect(book.getByRole('row', { name: /staging full/ })).toContainText('$2,500');
  await expect(book.getByRole('button', { name: 'Import CSV' })).toHaveCount(0);
  await expect(book.getByRole('button', { name: /Edit/ })).toHaveCount(0);
});
