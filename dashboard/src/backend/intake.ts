/**
 * The Listing Prep intake's backend calls (P1): properties with their geocode and
 * confirmed facts, seller consent, photos (private storage + rows), the team's cost
 * book, and quotes. Row-level security decides what each call may do
 * (supabase/migrations/20261001120000_listing_prep_intake.sql); this file only shapes
 * requests and turns failures into messages people can act on.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GeocodeMatch } from '../../../supabase/functions/_shared/census.ts';
import { preparePhoto, type CostRow, type Facts, type PropertyStatus, type Room, type ValuePrior } from '../lib/intake';
import { DeskError, friendly } from './desk';

export type { GeocodeMatch };

export const PHOTO_BUCKET = 'property-photos';
/** Signed photo URLs live five minutes: long enough to load a page, short enough not to travel. */
export const PHOTO_URL_SECONDS = 300;

/**
 * The consent text sellers agree to: a DRAFT for counsel's review (docs/legal/CONSENT_DRAFT.md,
 * kept in sync with it). Only consents under PROCESSING_VERSIONS allow AI analysis; the
 * database enforces the same list (`processing_consent()`).
 */
export const CONSENT_VERSION = '2026-10b';
export const PROCESSING_VERSIONS: readonly string[] = ['2026-10b'];
export const CONSENT_TITLE = 'Consent to photograph and analyze the property';
export const CONSENT_TEXT: readonly string[] = [
  'I agree that my listing agent’s brokerage may upload photos of my property to the brokerage’s private online workspace, to prepare an analysis of what to repair or improve before listing. I understand that:',
  'AI analysis by a third party. The photos are analyzed by an artificial intelligence model run by a third-party provider (currently Anthropic, PBC), acting for the brokerage. The provider processes the photos only to return the analysis. Under its commercial terms, it does not use them to train its models. It may keep them for a limited period under its own policies, for safety and abuse monitoring.',
  'Condition only. The analysis covers the property’s condition and possible repairs and improvements. Photos that show people are skipped. The analysis does not describe occupants, their belongings, or the neighborhood’s residents.',
  'Storage and retention. The photos are stored privately with a cloud provider in the United States. Only the brokerage team’s members can see them. They are deleted 12 months after upload, or within 30 days after I revoke this consent, whichever comes first. They are deleted sooner if I ask.',
  'Revoking. I can revoke this consent at any time by telling my agent. From that moment, no photo is analyzed, the photos are hidden from the brokerage’s workspace, and any analysis based on them is withdrawn.',
  'Not an appraisal. The analysis helps prepare the listing. It is not an appraisal, an inspection, or a guarantee of sale price.',
];

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

export type FindingStatus = 'proposed' | 'confirmed' | 'edited' | 'rejected' | 'withdrawn';

export interface Finding {
  id: string;
  photo_id: string | null;
  room: string;
  category: string;
  condition: number;
  issue: string;
  suggested_fix: string | null;
  fix_item: string | null;
  quantity: number | null;
  severity: 'cosmetic' | 'minor_repair' | 'major_repair';
  evidence: { x: number; y: number; w: number; h: number } | null;
  model_confidence: 'high' | 'medium' | 'low' | null;
  status: FindingStatus;
  agent_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface VisionJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  photos_total: number | null;
  photos_done: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface PhotoResult {
  photo_id: string;
  outcome: 'analyzed' | 'skipped_people' | 'skipped_unusable' | 'rejected_metadata';
  note: string | null;
}

/** What the worker computed for a property (P3): see agents/listing_prep/insights.py. */
export interface Insights {
  valuation: {
    low: number;
    high: number;
    /** Only with comparable sales; a rough range has none. */
    mid: number | null;
    method: 'zip_ppsf' | 'comps';
    confidence: 'high' | 'moderate' | 'low';
    /** rough: area medians, not calibrated; calibrated: an interval with measured coverage. */
    interval: 'rough' | 'calibrated' | 'uncalibrated';
    coverage_target: number | null;
    measured_coverage: number | null;
    notes: string[];
    inputs: Record<string, number | string | null>;
  } | null;
  segments: Array<{ key: string; label: string; weight: number; priorities: string[]; evidence: string[]; reliable: boolean; reliability: string | null }> | null;
  schools: Array<{ name: string; level: string; grades: string; charter: boolean; miles: number; cds: string; dashboard_url: string }> | null;
  amenities: Array<{ kind: string; count: number; nearest_miles: number | null }> | null;
  sources: string[];
  notes: string[];
  computed_at: string;
}

export type FindingEdit = Partial<Pick<Finding, 'condition' | 'issue' | 'suggested_fix' | 'fix_item' | 'quantity' | 'severity' | 'status' | 'agent_note'>>;

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
  if (/only a manager can delete all photos/.test(message)) return 'Only a manager can delete all of a property’s photos.';
  if (/withdrawn finding/.test(message)) return 'This finding was withdrawn when consent was revoked. Run the analysis again under a new consent.';
  if (/vision_jobs_one_active|duplicate key.*vision_jobs/.test(message)) return 'An analysis is already queued or running for this property.';
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
        throw new DeskError(
          status === 400
            ? 'Enter a street address with a number, e.g. “1 Civic Center Plaza, Irvine, CA”.'
            : status === 429
              ? 'That’s a lot of lookups in a short time. Wait a minute and try again, or enter the ZIP to continue without a map pin.'
              : 'The address lookup isn’t answering right now. Enter the ZIP to continue without a map pin.',
        );
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
        PHOTO_URL_SECONDS,
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

    /** Delete every photo of a property (managers; works while photos are hidden by a revocation). */
    async purgePhotos(property: string): Promise<number> {
      return check(await c.rpc('purge_property_photos', { property })) as number;
    },

    async insights(property: string): Promise<Insights | null> {
      return check(await c.from('property_insights').select('valuation, segments, schools, amenities, sources, notes, computed_at').eq('property_id', property).maybeSingle<Insights>());
    },

    async latestJob(property: string): Promise<VisionJob | null> {
      const rows = check(await c.from('vision_jobs').select('id, status, photos_total, photos_done, error, created_at, finished_at').eq('property_id', property).order('created_at', { ascending: false }).limit(1)) as VisionJob[];
      return rows[0] ?? null;
    },

    async requestAnalysis(property: string, me: string): Promise<void> {
      check(await c.from('vision_jobs').insert({ property_id: property, requested_by: me }).select('id'));
    },

    async photoResults(photoIds: readonly string[]): Promise<PhotoResult[]> {
      if (!photoIds.length) return [];
      return check(await c.from('photo_results').select('photo_id, outcome, note').in('photo_id', [...photoIds])) as PhotoResult[];
    },

    async findings(property: string): Promise<Finding[]> {
      const rows = check(
        await c
          .from('findings')
          .select('id, photo_id, room, category, condition, issue, suggested_fix, fix_item, quantity, severity, evidence, model_confidence, status, agent_note, reviewed_at, created_at')
          .eq('property_id', property)
          .order('created_at'),
      ) as Finding[];
      return rows.map((r) => ({ ...r, quantity: r.quantity === null ? null : Number(r.quantity) }));
    },

    async reviewFinding(id: string, edit: FindingEdit): Promise<void> {
      check(await c.from('findings').update(edit).eq('id', id).select('id'));
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

    async valuePriors(team: string): Promise<ValuePrior[]> {
      const rows = check(await c.from('value_priors').select('item, recovery_low, recovery_high, source, notes').eq('team_id', team).order('item')) as ValuePrior[];
      return rows.map((r) => ({ ...r, recovery_low: Number(r.recovery_low), recovery_high: Number(r.recovery_high) }));
    },

    /** Insert or replace priors by item, through save_value_priors (managers only). */
    async saveValuePriors(team: string, rows: readonly ValuePrior[]): Promise<void> {
      if (!rows.length) return;
      check(await c.rpc('save_value_priors', { team, rows }));
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
