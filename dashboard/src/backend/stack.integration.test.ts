// @vitest-environment node
/**
 * Listing Prep intake end to end on the real local Supabase stack (the `desk-db` workflow
 * sets DESK_TEST_API_URL and DESK_TEST_ANON_KEY after `supabase start`). Two people sign
 * up on the stack's auth, and the Desk's own API module drives PostgREST, the RPCs,
 * Storage and the `geocode` Edge Function (which calls the live Census geocoder), as the
 * site does. Skipped elsewhere: the browser flows are covered by e2e/intake.spec.ts
 * against a fake, and the access rules by *.rls.test.ts.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { deskApi } from './desk';
import { intakeApi, PHOTO_BUCKET } from './intake';

const URL_ = process.env.DESK_TEST_API_URL ?? '';
const ANON = process.env.DESK_TEST_ANON_KEY ?? '';

// A real 1×1 JPEG.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

async function person(tag: string): Promise<{ c: SupabaseClient; id: string }> {
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const { data, error } = await c.auth.signUp({ email, password: `pw-${crypto.randomUUID()}` });
  if (error || !data.session) throw new Error(`sign-up failed: ${error?.message ?? 'no session (are email confirmations on?)'}`);
  return { c, id: data.session.user.id };
}

describe.runIf(Boolean(URL_ && ANON))('intake on the real local Supabase stack', () => {
  it('adds a geocoded property, confirms facts, records consent, stores a photo, and keeps it all from another team', async () => {
    const alice = await person('alice');
    const carol = await person('carol');
    const team = await deskApi(alice.c).createTeam('Coastline Realty');
    await deskApi(carol.c).createTeam('Canyon Homes');
    const api = intakeApi(alice.c);

    // The Edge Function reaches the Census geocoder; the city id is the region data's.
    const [match] = await api.geocode('1 Civic Center Plaza, Irvine, CA 92606');
    expect(match).toMatchObject({ zip: '92606', placeId: '0636770', countyFips: '06059' });
    const id = await api.addProperty(team, alice.id, {
      address: '1 Civic Center Plaza, Irvine, CA 92606',
      matched_address: match!.matchedAddress,
      lat: match!.lat,
      lon: match!.lon,
      zip: match!.zip,
      city: match!.placeName,
      place_id: match!.placeId,
      tract: match!.tract,
      county_fips: match!.countyFips,
    });

    await expect(api.confirmFacts(id)).rejects.toThrow(/Confirm needs beds, baths, sqft, year built, property type first/);
    await api.saveFacts(id, { beds: 3, baths: 2.5, sqft: 1850, year_built: 1978, property_type: 'single_family' });
    await api.confirmFacts(id);
    expect((await api.property(id))?.facts_confirmed_at).toBeTruthy();
    await api.saveFacts(id, { beds: 3, baths: 2.5, sqft: 1900, year_built: 1978, property_type: 'single_family' });
    expect((await api.property(id))?.facts_confirmed_at).toBeNull();

    // No consent, no upload; then the photo goes into the property's folder and reads back signed.
    const path = `${team}/${id}/${crypto.randomUUID()}.jpg`;
    const refused = await alice.c.storage.from(PHOTO_BUCKET).upload(path, JPEG, { contentType: 'image/jpeg' });
    expect(refused.error).toBeTruthy();
    await api.recordConsent(id, alice.id, { seller_name: 'Pat Seller', method: 'signed_form', given_on: '2026-10-01' });
    const up = await alice.c.storage.from(PHOTO_BUCKET).upload(path, JPEG, { contentType: 'image/jpeg' });
    expect(up.error).toBeNull();
    const row = await alice.c.from('photos').insert({ property_id: id, room: 'kitchen', storage_path: path, width: 1, height: 1, bytes: JPEG.length, mime: 'image/jpeg', uploaded_by: alice.id });
    expect(row.error).toBeNull();
    const [photo] = await api.photos(id);
    expect(photo).toMatchObject({ room: 'kitchen', storage_path: path });
    const fetched = await fetch(photo!.url!);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).subarray(0, 3)).toEqual(JPEG.subarray(0, 3));

    // The cost book and a quote.
    await api.saveCostRows(team, [{ item: 'interior_paint_walls', category: 'paint', unit: 'sq_ft_floor_area', low_usd: 2.5, high_usd: 4.5, notes: null }]);
    await api.addQuote(id, alice.id, { item: 'interior_paint_walls', low_usd: 6400, high_usd: 7200, vendor: 'Brightline Painting', notes: null, quoted_on: null });
    expect((await api.costBook(team))[0]).toMatchObject({ low_usd: 2.5, high_usd: 4.5 });
    expect((await api.quotes(id))[0]).toMatchObject({ low_usd: 6400, high_usd: 7200 });

    // Another team sees none of it: not the row, the photo row, the file or the quotes.
    const other = intakeApi(carol.c);
    expect(await other.property(id)).toBeNull();
    expect(await other.photos(id)).toEqual([]);
    expect(await other.quotes(id)).toEqual([]);
    expect((await carol.c.storage.from(PHOTO_BUCKET).download(path)).error).toBeTruthy();
    const anonymous = createClient(URL_, ANON, { auth: { persistSession: false } });
    expect((await anonymous.storage.from(PHOTO_BUCKET).download(path)).error).toBeTruthy();
    expect((await anonymous.from('properties').select('id')).data ?? []).toEqual([]);

    // Deleting the photo removes the file too.
    await api.deletePhoto(photo!);
    expect((await alice.c.storage.from(PHOTO_BUCKET).download(path)).error).toBeTruthy();
  }, 60_000);
});
