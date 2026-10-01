/**
 * The Listing Prep intake's backend calls (P1): properties with their geocode and
 * confirmed facts, seller consent, photos (private storage + rows), the team's cost
 * book, and quotes. Row-level security decides what each call may do
 * (supabase/migrations/20261001120000_listing_prep_intake.sql); this file only shapes
 * requests and turns failures into messages people can act on.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GeocodeMatch } from '../../../supabase/functions/_shared/census.ts';
import { preparePhoto, type CostRow, type Facts, type PropertyStatus, type Room } from '../lib/intake';
import { DeskError, friendly } from './desk';

export type { GeocodeMatch };

export const PHOTO_BUCKET = 'property-photos';

/** The consent text sellers agree to (a default; the brokerage's counsel should review it). */
export const CONSENT_VERSION = '2026-10';
export const CONSENT_TEXT =
  'The seller agrees that photos of the property may be uploaded to the brokerage’s private workspace and analyzed by an AI model, only to prepare a pre-listing market analysis for this property. Photos stay private to the brokerage team, are not used to train AI models, and are deleted on request.';


export interface PropertySummary {
  id: string;
  address: string;
  city: string | null;
  zip: string | null;
  status: PropertyStatus;
  facts_confirmed_at: string | null;
  created_at: string;
}

export interface Property extends PropertySummary {
  team_id: string;
  matched_address: string | null;
  lat: number | null;
  lon: number | null;
  place_id: string | null;
  tract: string | null;
  county_fips: string | null;
  facts: Facts;
  facts_confirmed_by: string | null;
  notes: string | null;
}

export interface Consent {
  id: string;
  seller_name: string;
  method: 'signed_form' | 'email' | 'in_person';
  consent_version: string;
  given_on: string;
  recorded_by: string;
  revoked_at: string | null;
}

export interface Photo {
  id: string;
  room: Room;
  label: string | null;
  storage_path: string;
  width: number | null;
  height: number | null;
  uploaded_by: string;
  created_at: string;
  /** A short-lived signed URL (the bucket is private). */
  url: string | null;
}

export interface Quote {
  id: string;
  item: string;
  low_usd: number;
  high_usd: number;
  vendor: string | null;
  notes: string | null;
  quoted_on: string | null;
  created_by: string;
}

export interface NewProperty {
  address: string;
  matched_address?: string | null;
  lat?: number | null;
  lon?: number | null;
  zip?: string | null;
  city?: string | null;
  place_id?: string | null;
  tract?: string | null;
  county_fips?: string | null;
}

/** Intake-specific database messages, then the Desk's general ones. */
export function intakeMessage(message: string): string {
  const incomplete = /facts incomplete: (.+)/.exec(message);
  if (incomplete) return `Confirm needs ${incomplete[1]!.replace(/_/g, ' ')} first.`;
  if (/properties_facts_valid/.test(message)) return 'One of the facts is out of range. Check the highlighted fields.';
  if (/cost_book_pkey|duplicate key.*cost_book/.test(message)) return 'That item is already in the cost book.';
  if (/a consent can only be revoked/.test(message)) return 'A consent can only be revoked. Record a new one instead.';
  return friendly(message);
}

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new DeskError(intakeMessage(res.error.message));
  return res.data as T;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const SUMMARY = 'id, address, city, zip, status, facts_confirmed_at, created_at';

export function intakeApi(c: SupabaseClient) {
  return {
    async geocode(address: string): Promise<GeocodeMatch[]> {
      const { data, error } = await c.functions.invoke<{ matches: GeocodeMatch[] }>('geocode', { body: { address } });
      if (error) {
        const status = (error as { context?: { status?: number } }).context?.status;
        throw new DeskError(status === 400 ? 'Enter a street address with a number, e.g. “1 Civic Center Plaza, Irvine, CA”.' : 'The address lookup isn’t answering right now. Enter the ZIP to continue without a map pin.');
      }
      return data?.matches ?? [];
    },

    async properties(team: string): Promise<PropertySummary[]> {
      return check(await c.from('properties').select(SUMMARY).eq('team_id', team).order('created_at', { ascending: false }));
    },

    async addProperty(team: string, me: string, p: NewProperty): Promise<string> {
      const row = check(await c.from('properties').insert({ team_id: team, created_by: me, ...p }).select('id').single<{ id: string }>());
      return row.id;
    },

    async property(id: string): Promise<Property | null> {
      return check(await c.from('properties').select('*').eq('id', id).maybeSingle<Property>());
    },

    async saveFacts(id: string, facts: Record<string, unknown>): Promise<void> {
      check(await c.from('properties').update({ facts }).eq('id', id).select('id'));
    },

    async confirmFacts(id: string): Promise<string> {
      return check(await c.rpc('confirm_facts', { property: id })) as string;
    },

    async setStatus(id: string, status: PropertyStatus): Promise<void> {
      check(await c.from('properties').update({ status }).eq('id', id).select('id'));
    },

    async consents(property: string): Promise<Consent[]> {
      return check(await c.from('seller_consents').select('id, seller_name, method, consent_version, given_on, recorded_by, revoked_at').eq('property_id', property).order('created_at'));
    },

    async recordConsent(property: string, me: string, c0: { seller_name: string; method: Consent['method']; given_on: string }): Promise<void> {
      check(await c.from('seller_consents').insert({ property_id: property, recorded_by: me, consent_version: CONSENT_VERSION, ...c0 }).select('id'));
    },

    async revokeConsent(id: string): Promise<void> {
      check(await c.from('seller_consents').update({ revoked_at: new Date().toISOString() }).eq('id', id).select('id'));
    },

    async photos(property: string): Promise<Photo[]> {
      const rows = check(await c.from('photos').select('id, room, label, storage_path, width, height, uploaded_by, created_at').eq('property_id', property).order('created_at')) as Omit<Photo, 'url'>[];
      if (!rows.length) return [];
      const { data } = await c.storage.from(PHOTO_BUCKET).createSignedUrls(
        rows.map((r) => r.storage_path),
        3600,
      );
      const urls = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
      return rows.map((r) => ({ ...r, url: urls.get(r.storage_path) ?? null }));
    },

    /** Resize + strip metadata, upload to <team>/<property>/<uuid>.jpg, then record the row (removing the file if that fails). */
    async uploadPhoto(team: string, property: string, me: string, room: Room, file: Blob): Promise<void> {
      const { blob, width, height } = await preparePhoto(file);
      const path = `${team}/${property}/${crypto.randomUUID()}.jpg`;
      const up = await c.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw new DeskError(intakeMessage(up.error.message));
      const row = await c.from('photos').insert({ property_id: property, room, storage_path: path, width, height, bytes: blob.size, mime: 'image/jpeg', uploaded_by: me }).select('id');
      if (row.error) {
        await c.storage.from(PHOTO_BUCKET).remove([path]);
        throw new DeskError(intakeMessage(row.error.message));
      }
    },

    async setPhotoRoom(id: string, room: Room): Promise<void> {
      check(await c.from('photos').update({ room }).eq('id', id).select('id'));
    },

    async deletePhoto(photo: Pick<Photo, 'id' | 'storage_path'>): Promise<void> {
      const removed = check(await c.from('photos').delete().eq('id', photo.id).select('id')) as unknown[];
      if (!removed.length) throw new DeskError('Only the person who added a photo, or a manager, can delete it.');
      await c.storage.from(PHOTO_BUCKET).remove([photo.storage_path]);
    },

    async costBook(team: string): Promise<CostRow[]> {
      const rows = check(await c.from('cost_book').select('item, category, unit, low_usd, high_usd, notes').eq('team_id', team).order('category').order('item')) as CostRow[];
      return rows.map((r) => ({ ...r, low_usd: num(r.low_usd), high_usd: num(r.high_usd) }));
    },

    /** Insert or replace rows by item (a CSV import, or one edit), through save_cost_rows (see the migration). */
    async saveCostRows(team: string, rows: readonly CostRow[]): Promise<void> {
      if (!rows.length) return;
      check(await c.rpc('save_cost_rows', { team, rows }));
    },

    async deleteCostRow(team: string, item: string): Promise<void> {
      check(await c.from('cost_book').delete().eq('team_id', team).eq('item', item).select('item'));
    },

    async quotes(property: string): Promise<Quote[]> {
      const rows = check(await c.from('quotes').select('id, item, low_usd, high_usd, vendor, notes, quoted_on, created_by').eq('property_id', property).order('created_at')) as Quote[];
      return rows.map((r) => ({ ...r, low_usd: Number(r.low_usd), high_usd: Number(r.high_usd) }));
    },

    async addQuote(property: string, me: string, q: Omit<Quote, 'id' | 'created_by'>): Promise<void> {
      check(await c.from('quotes').insert({ property_id: property, created_by: me, ...q }).select('id'));
    },

    async deleteQuote(id: string): Promise<void> {
      const removed = check(await c.from('quotes').delete().eq('id', id).select('id')) as unknown[];
      if (!removed.length) throw new DeskError('Only the person who added a quote, or a manager, can delete it.');
    },
  };
}
