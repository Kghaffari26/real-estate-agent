/**
 * Listing Prep intake (P1), the pure parts: the facts an agent confirms (the same rules
 * as the database's `valid_facts`, tested on shared vectors), the cost book's CSV, photo
 * rooms and coverage, image sizing, and the market context for an address from the
 * published region data. SPEC_LISTING_PREP.md §4, §8.
 */
import type { RegionOutput } from '../data/schema.gen';

// ---------- properties ----------

export type PropertyStatus = 'watching' | 'preparing' | 'listed' | 'under_contract' | 'sold' | 'archived';

export const STATUS_LABELS: Record<PropertyStatus, string> = {
  watching: 'Watching',
  preparing: 'Preparing to list',
  listed: 'Listed',
  under_contract: 'Under contract',
  sold: 'Sold',
  archived: 'Archived',
};

// ---------- facts ----------

export type PropertyType = 'single_family' | 'condo' | 'townhouse' | 'multi_family' | 'manufactured';

export interface Facts {
  beds?: number;
  baths?: number;
  sqft?: number;
  lot_sqft?: number;
  year_built?: number;
  property_type?: PropertyType;
  garage_spaces?: number;
  stories?: number;
  pool?: boolean;
  hoa_monthly?: number;
  last_sale_price?: number;
  last_sale_date?: string;
}

interface NumField {
  key: keyof Facts;
  kind: 'int' | 'quarter' | 'money';
  label: string;
  min: number;
  max: number;
  unit?: string;
}

export const NUM_FIELDS: readonly NumField[] = [
  { key: 'beds', kind: 'int', label: 'Bedrooms', min: 0, max: 30 },
  { key: 'baths', kind: 'quarter', label: 'Bathrooms', min: 0, max: 30 },
  { key: 'sqft', kind: 'int', label: 'Living area', min: 100, max: 50000, unit: 'sq ft' },
  { key: 'lot_sqft', kind: 'int', label: 'Lot size', min: 0, max: 50000000, unit: 'sq ft' },
  { key: 'year_built', kind: 'int', label: 'Year built', min: 1800, max: 2100 },
  { key: 'stories', kind: 'int', label: 'Stories', min: 1, max: 6 },
  { key: 'garage_spaces', kind: 'int', label: 'Garage spaces', min: 0, max: 20 },
  { key: 'hoa_monthly', kind: 'money', label: 'HOA dues', min: 0, max: 50000, unit: '$ / month' },
  { key: 'last_sale_price', kind: 'money', label: 'Last sale price', min: 0, max: 500000000, unit: '$' },
];

export const PROPERTY_TYPES: ReadonlyArray<{ value: PropertyType; label: string }> = [
  { value: 'single_family', label: 'Single-family' },
  { value: 'condo', label: 'Condo' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'multi_family', label: 'Multi-family (2–4)' },
  { value: 'manufactured', label: 'Manufactured' },
];

/** What confirm_facts requires before anything is analyzed. */
export const CORE_FACTS: readonly (keyof Facts)[] = ['beds', 'baths', 'sqft', 'year_built', 'property_type'];

/** The problem with one fact, or null. Mirrors `public.valid_facts` in the migration. */
export function factProblem(key: string, value: unknown): string | null {
  const f = NUM_FIELDS.find((x) => x.key === key);
  if (f) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${f.label} must be a number`;
    if (value < f.min || value > f.max) return `${f.label} must be between ${f.min.toLocaleString('en-US')} and ${f.max.toLocaleString('en-US')}`;
    if (f.kind === 'int' && !Number.isInteger(value)) return `${f.label} must be a whole number`;
    if (f.kind === 'quarter' && !Number.isInteger(value * 4)) return `${f.label} counts in quarters (2, 2.5, 2.75…)`;
    return null;
  }
  if (key === 'property_type') return PROPERTY_TYPES.some((t) => t.value === value) ? null : 'Choose a property type';
  if (key === 'pool') return typeof value === 'boolean' ? null : 'Pool is yes or no';
  if (key === 'last_sale_date') return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : 'Last sale date must be a date';
  return `Unknown fact: ${key}`;
}

export function factsProblems(facts: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(facts)) {
    const p = factProblem(k, v);
    if (p) out[k] = p;
  }
  return out;
}

export const missingCore = (facts: Facts) => CORE_FACTS.filter((k) => facts[k] === undefined);

/** Form strings → facts: blanks drop the key; numbers parse with commas and $ removed. */
export function factsFromForm(form: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of NUM_FIELDS) {
    const raw = (form[f.key] ?? '').replace(/[$,\s]/g, '');
    if (raw !== '') out[f.key] = Number(raw);
  }
  if (form.property_type) out.property_type = form.property_type;
  if (form.pool === 'yes' || form.pool === 'no') out.pool = form.pool === 'yes';
  if (form.last_sale_date) out.last_sale_date = form.last_sale_date;
  return out;
}

export function formFromFacts(facts: Facts): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of NUM_FIELDS) if (facts[f.key] !== undefined) out[f.key] = String(facts[f.key]);
  if (facts.property_type) out.property_type = facts.property_type;
  if (facts.pool !== undefined) out.pool = facts.pool ? 'yes' : 'no';
  if (facts.last_sale_date) out.last_sale_date = facts.last_sale_date;
  return out;
}

// ---------- the cost book ----------

/** Dollars as the cost book and quotes show them: cents only when there are cents ($4.50, $1,200). */
export function formatDollars(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const cents = Math.round(v * 100) % 100 !== 0;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
}

export const COST_UNITS = ['each', 'piece', 'door', 'hour', 'month', 'sq_ft', 'sq_ft_floor_area', 'sq_ft_yard', 'linear_ft'] as const;
export type CostUnit = (typeof COST_UNITS)[number];

export const UNIT_LABELS: Record<CostUnit, string> = {
  each: 'each',
  piece: 'per piece',
  door: 'per door',
  hour: 'per hour',
  month: 'per month',
  sq_ft: 'per sq ft',
  sq_ft_floor_area: 'per sq ft of floor area',
  sq_ft_yard: 'per sq ft of yard',
  linear_ft: 'per linear ft',
};

export interface CostRow {
  item: string;
  category: string;
  unit: CostUnit;
  low_usd: number | null;
  high_usd: number | null;
  notes: string | null;
}

export const COST_HEADER = ['item', 'category', 'unit', 'low_usd', 'high_usd', 'notes'] as const;

/** RFC 4180 records (quoted fields may hold commas, quotes and newlines). */
export function parseCsvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // a spreadsheet's byte-order mark
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface CostImport {
  rows: CostRow[];
  /** Line-numbered problems (1 = the header); rows with problems are left out. */
  problems: string[];
}

/** The team's cost book from `docs/templates/cost_book.csv`'s format. Unpriced rows are kept (blank low/high). */
export function parseCostBook(text: string): CostImport {
  const records = parseCsvRecords(text);
  const header = (records[0] ?? []).map((h) => h.trim().toLowerCase());
  const missing = COST_HEADER.filter((h) => h !== 'notes' && !header.includes(h));
  if (missing.length) return { rows: [], problems: [`Line 1: missing column${missing.length > 1 ? 's' : ''} ${missing.join(', ')} (expected ${COST_HEADER.join(',')})`] };
  const col = (r: string[], name: string) => (r[header.indexOf(name)] ?? '').trim();
  const money = (s: string) => (s === '' ? null : Number(s.replace(/[$,\s]/g, '')));
  const rows: CostRow[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  records.slice(1).forEach((r, i) => {
    const line = i + 2;
    const item = col(r, 'item').toLowerCase();
    const category = col(r, 'category').toLowerCase();
    const unit = col(r, 'unit').toLowerCase() as CostUnit;
    const low = money(col(r, 'low_usd'));
    const high = money(col(r, 'high_usd'));
    const notes = header.includes('notes') ? col(r, 'notes') || null : null;
    const bad = (m: string) => problems.push(`Line ${line} (${item || 'no item'}): ${m}`);
    if (!/^[a-z0-9_]{2,60}$/.test(item)) return bad('item must be 2–60 lowercase letters, digits or _');
    if (seen.has(item)) return bad('listed twice');
    if (!/^[a-z0-9_]{2,40}$/.test(category)) return bad('category must be lowercase letters, digits or _');
    if (!COST_UNITS.includes(unit)) return bad(`unit must be one of ${COST_UNITS.join(', ')}`);
    if ((low === null) !== (high === null)) return bad('give both low_usd and high_usd, or neither');
    if (low !== null && high !== null) {
      if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0) return bad('prices must be dollar amounts ≥ 0');
      if (high < low) return bad('high_usd is below low_usd');
    }
    if (notes && notes.length > 500) return bad('notes are limited to 500 characters');
    seen.add(item);
    rows.push({ item, category, unit, low_usd: low, high_usd: high, notes });
  });
  return { rows, problems };
}

// ---------- photos ----------

export const ROOMS = [
  ['exterior_front', 'Front exterior'],
  ['exterior_back', 'Back exterior'],
  ['yard', 'Yard'],
  ['entry', 'Entry'],
  ['living', 'Living room'],
  ['family', 'Family room'],
  ['dining', 'Dining'],
  ['kitchen', 'Kitchen'],
  ['primary_bedroom', 'Primary bedroom'],
  ['bedroom', 'Bedroom'],
  ['primary_bath', 'Primary bath'],
  ['bath', 'Bathroom'],
  ['half_bath', 'Half bath'],
  ['office', 'Office'],
  ['laundry', 'Laundry'],
  ['garage', 'Garage'],
  ['hallway', 'Hallway'],
  ['other', 'Other'],
] as const;
export type Room = (typeof ROOMS)[number][0];
export const roomLabel = (room: string) => ROOMS.find(([r]) => r === room)?.[1] ?? room;

/** Rooms every report needs a photo of; more are asked for by the facts (bedrooms, baths, garage). */
export function expectedRooms(facts: Facts): Room[] {
  const rooms: Room[] = ['exterior_front', 'kitchen', 'living', 'primary_bedroom', 'primary_bath'];
  if ((facts.beds ?? 0) > 1) rooms.push('bedroom');
  if ((facts.baths ?? 0) >= 2) rooms.push('bath');
  if ((facts.garage_spaces ?? 0) > 0) rooms.push('garage');
  if (facts.property_type !== 'condo') rooms.push('exterior_back');
  return rooms;
}

/** Expected rooms with no photo yet ("missing rooms are asked for, not assumed", spec §4). */
export function missingRooms(facts: Facts, photographed: readonly string[]): Room[] {
  const have = new Set(photographed);
  return expectedRooms(facts).filter((r) => !have.has(r));
}

/** Fit (w, h) inside a max edge, never upscaling. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

export const PHOTO_MAX_EDGE = 2048;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/**
 * A photo re-encoded as JPEG at most 2048 px on its long edge. Re-encoding through a canvas
 * also drops the file's metadata (EXIF: the camera's GPS position, device, timestamps),
 * so only pixels leave the agent's device.
 */
export async function preparePhoto(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, PHOTO_MAX_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('This image could not be read.');
  if (blob.size > PHOTO_MAX_BYTES) throw new Error('This image is too large even after resizing.');
  return { blob, width, height };
}

// ---------- market context ----------

type Area = RegionOutput['zips'][number];

export interface MarketContext {
  zip: Area | null;
  city: Area | null;
  /** The ZIP's rank by median sale price among well-sampled ZIPs (1 = priciest), and of how many. */
  zipPriceRank: { rank: number; of: number } | null;
}

/** The published ZIP and city markets for an address; the city by place id, else by the ZIP's city name. */
export function marketContext(region: RegionOutput, zip: string | null, placeId: string | null): MarketContext {
  const z = zip ? (region.zips.find((a) => a.id === zip) ?? null) : null;
  const city = (placeId ? region.cities.find((c) => c.id === placeId) : undefined) ?? (z?.city ? region.cities.find((c) => c.name === z.city) : undefined) ?? null;
  let zipPriceRank: MarketContext['zipPriceRank'] = null;
  const price = (a: Area) => a.latest.median_sale_price?.value ?? null;
  if (z && !z.low_sample && price(z) !== null) {
    const ranked = region.zips.filter((a) => !a.low_sample && price(a) !== null).sort((a, b) => price(b)! - price(a)!);
    zipPriceRank = { rank: ranked.findIndex((a) => a.id === z.id) + 1, of: ranked.length };
  }
  return { zip: z, city, zipPriceRank };
}

// ---------- photo findings (P2) ----------

export const CATEGORY_LABELS: Record<string, string> = {
  paint: 'Paint',
  walls_ceilings: 'Walls and ceilings',
  flooring: 'Flooring',
  lighting: 'Lighting',
  fixtures_hardware: 'Fixtures and hardware',
  cabinets: 'Cabinets',
  countertops: 'Countertops',
  appliances: 'Appliances',
  windows_doors: 'Windows and doors',
  storage: 'Storage',
  bath: 'Bath',
  landscaping: 'Landscaping',
  exterior: 'Exterior',
  roof_gutters: 'Roof and gutters',
  curb_appeal: 'Curb appeal',
  decluttering: 'Decluttering',
  cleaning: 'Cleaning',
  repair: 'Repair',
  staging: 'Staging',
  other: 'Other',
};

export const SEVERITY_LABELS = { cosmetic: 'Cosmetic', minor_repair: 'Minor repair', major_repair: 'Major repair' } as const;
export const CONDITION_LABELS = ['', 'Needs replacing', 'Worn or dated', 'Average wear', 'Good', 'Like new'] as const;

export type Readiness = { ok: true } | { ok: false; reason: string };

/** Whether an analysis can be requested now, and if not, what to do first (the database checks the same). */
export function analysisReadiness(p: {
  factsConfirmed: boolean;
  consent: { version: string } | null;
  processingVersions: readonly string[];
  photos: number;
  pendingPhotos: number;
  jobActive: boolean;
}): Readiness {
  if (p.jobActive) return { ok: false, reason: 'An analysis is already queued or running.' };
  if (!p.factsConfirmed) return { ok: false, reason: 'Confirm the facts first.' };
  if (!p.consent) return { ok: false, reason: 'Record the seller’s consent first.' };
  if (!p.processingVersions.includes(p.consent.version))
    return { ok: false, reason: `The seller’s consent was recorded under text ${p.consent.version}, which doesn’t cover AI analysis. Record consent to the current text first.` };
  if (p.photos === 0) return { ok: false, reason: 'Add photos first.' };
  if (p.pendingPhotos === 0) return { ok: false, reason: 'Every photo has been analyzed. Add new photos to analyze them.' };
  return { ok: true };
}

export function findingCounts(findings: ReadonlyArray<{ status: string }>): Record<'proposed' | 'confirmed' | 'edited' | 'rejected' | 'withdrawn', number> {
  const out = { proposed: 0, confirmed: 0, edited: 0, rejected: 0, withdrawn: 0 };
  for (const f of findings) if (f.status in out) out[f.status as keyof typeof out]++;
  return out;
}

// ---------- value priors (P4) ----------

export interface ValuePrior {
  item: string;
  recovery_low: number;
  recovery_high: number;
  source: string;
  notes: string | null;
}

export const PRIOR_HEADER = ['item', 'recovery_low', 'recovery_high', 'source', 'notes'] as const;

/**
 * The team's value priors from `docs/templates/value_priors.csv`: the share of an item's
 * cost recovered at resale (1.2 = 120%), low to high, and the source the team relies on.
 * Rows left blank are skipped (no prior: "not enough evidence"); a priced row needs a source.
 */
export function parseValuePriors(text: string): { rows: ValuePrior[]; problems: string[]; blank: number } {
  const records = parseCsvRecords(text);
  const header = (records[0] ?? []).map((h) => h.trim().toLowerCase());
  const missing = PRIOR_HEADER.filter((h) => h !== 'notes' && !header.includes(h));
  if (missing.length) return { rows: [], problems: [`Line 1: missing column${missing.length > 1 ? 's' : ''} ${missing.join(', ')} (expected ${PRIOR_HEADER.join(',')})`], blank: 0 };
  const col = (r: string[], name: string) => (r[header.indexOf(name)] ?? '').trim();
  const ratio = (s: string) => (s === '' ? null : s.endsWith('%') ? Number(s.slice(0, -1)) / 100 : Number(s));
  const rows: ValuePrior[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  let blank = 0;
  records.slice(1).forEach((r, i) => {
    const line = i + 2;
    const item = col(r, 'item').toLowerCase();
    const lo = ratio(col(r, 'recovery_low'));
    const hi = ratio(col(r, 'recovery_high'));
    const source = col(r, 'source');
    const notes = header.includes('notes') ? col(r, 'notes') || null : null;
    const bad = (m: string) => problems.push(`Line ${line} (${item || 'no item'}): ${m}`);
    if (!/^[a-z0-9_]{2,60}$/.test(item)) return bad('item must be 2–60 lowercase letters, digits or _');
    if (lo === null && hi === null) {
      blank++;
      return;
    }
    if (seen.has(item)) return bad('listed twice');
    if (lo === null || hi === null) return bad('give both recovery_low and recovery_high');
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi > 10) return bad('recoveries are ratios like 0.8 or 1.25 (or 80%, 125%)');
    if (hi < lo) return bad('recovery_high is below recovery_low');
    if (source.length < 2) return bad('name the source of this prior (it’s shown with every estimate that uses it)');
    seen.add(item);
    rows.push({ item, recovery_low: lo, recovery_high: hi, source, notes });
  });
  return { rows, problems, blank };
}
