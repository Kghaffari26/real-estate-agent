/**
 * Loading and parsing published JSON. Files are served from `<base>/data/`, which
 * `npm run fetch-data` fills from the data branch (or the committed sample snapshot).
 * Every file goes through its zod schema; results are cached per path for the session.
 */
import { z } from 'zod';
import { timelineFromSeries, type Timeline } from '../lib/timeline';
import { DataSourceSchema, ManifestEntrySchema, type DataSource, type ManifestEntry } from './manifest';
import {
  AreasOutputSchema,
  EventsOutputSchema,
  IndexOutputSchema,
  MetroDetailOutputSchema,
  PulseOutputSchema,
  RegionGeometrySchema,
  RegionOutputSchema,
  type AreasOutput,
  type EventsOutput,
  type IndexOutput,
  type MetroDetailOutput,
  type PulseOutput,
  type RegionGeometry,
  type RegionOutput,
} from './schema.gen';

export class DataError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_found' | 'network' | 'invalid',
  ) {
    super(message);
    this.name = 'DataError';
  }
}

/** The deploy's data version (a content hash); `?v=` makes each deploy fetch its own data. */
export const DATA_VERSION: string = typeof __DATA_VERSION__ === 'string' ? __DATA_VERSION__ : 'dev';

export function dataUrl(path: string, version: string = DATA_VERSION): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}data/${path}?v=${encodeURIComponent(version)}`;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string | undefined): slug is string {
  return typeof slug === 'string' && SLUG.test(slug);
}

async function fetchJson(path: string, fetcher: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(dataUrl(path), { headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new DataError(`Couldn't reach ${path}: ${(error as Error).message}`, 'network');
  }
  if (response.status === 404) throw new DataError(`${path} was not found`, 'not_found');
  if (!response.ok) throw new DataError(`${path} returned HTTP ${response.status}`, 'network');
  try {
    return await response.json();
  } catch {
    // Static hosts often answer a missing file with an HTML page.
    throw new DataError(`${path} is not valid JSON`, 'invalid');
  }
}

export function parseWith<S extends z.ZodTypeAny>(schema: S, raw: unknown, what: string): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new DataError(`${what} doesn't match the data contract (${issues})`, 'invalid');
  }
  return parsed.data;
}

const cache = new Map<string, Promise<unknown>>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  let hit = cache.get(key) as Promise<T> | undefined;
  if (!hit) {
    hit = load();
    cache.set(key, hit);
    // Don't cache failures: a retry should refetch.
    hit.catch(() => cache.delete(key));
  }
  return hit;
}

export function clearCache(): void {
  cache.clear();
}

export function loadIndex(fetcher: typeof fetch = fetch): Promise<IndexOutput> {
  return cached('latest.json', async () => parseWith(IndexOutputSchema, await fetchJson('latest.json', fetcher), 'latest.json'));
}

export function loadMetro(slug: string, fetcher: typeof fetch = fetch): Promise<MetroDetailOutput> {
  if (!isValidSlug(slug)) return Promise.reject(new DataError(`"${slug}" is not a metro`, 'not_found'));
  const path = `metros/${slug}.json`;
  return cached(path, async () => parseWith(MetroDetailOutputSchema, await fetchJson(path, fetcher), path));
}

export function loadManifest(fetcher: typeof fetch = fetch): Promise<ManifestEntry> {
  return cached('manifest-entry.json', async () =>
    parseWith(ManifestEntrySchema, await fetchJson('manifest-entry.json', fetcher), 'manifest-entry.json'),
  );
}

/** Where the data came from; unknown (null) when source.json is missing. */
export function loadDataSource(fetcher: typeof fetch = fetch): Promise<DataSource | null> {
  return cached('source.json', async () => {
    try {
      return parseWith(DataSourceSchema, await fetchJson('source.json', fetcher), 'source.json');
    } catch {
      return null;
    }
  });
}

const TimelineFileSchema = z.object({
  dates: z.array(z.string()),
  metros: z.record(z.string(), z.array(z.number().nullable())),
});

/**
 * One metric's history for every metro (the time machine). Prefers the compact
 * `timeline/<metric>.json` (spec §8.2 E1); until the agent publishes it, falls back
 * to the metro files' 36-month series (fetched once, cached for the session).
 */
export function loadTimeline(metric: string, slugs: readonly string[], options: { compact?: boolean; fetcher?: typeof fetch } = {}): Promise<Timeline> {
  const { compact = false, fetcher = fetch } = options;
  const path = `timeline/${metric}.json`;
  return cached(`${path}|${slugs.length}|${compact}`, async () => {
    // Only ask for the compact file when the index says it exists (no 404 noise otherwise).
    if (compact) {
      try {
        return parseWith(TimelineFileSchema, await fetchJson(path, fetcher), path);
      } catch {
        // Unreachable or malformed: the metro files carry the same history.
      }
    }
    const files = await Promise.allSettled(slugs.map((s) => loadMetro(s, fetcher)));
    const ok = files.flatMap((r, i) => (r.status === 'fulfilled' ? [{ slug: slugs[i]!, series: r.value.series as Record<string, ReadonlyArray<string | number | null>> }] : []));
    if (!ok.length) throw new DataError('No metro history could be loaded', 'network');
    return timelineFromSeries(ok, metric);
  });
}

// ---------- §6.5-6.7 extension files (optional: null when absent or malformed) ----------

/** Loads an optional file the index lists; any failure is "not available", never an error state. */
function optional<T>(path: string, parse: (raw: unknown) => T, fetcher: typeof fetch): Promise<T | null> {
  return cached(`optional:${path}`, async () => {
    try {
      return parse(await fetchJson(path, fetcher));
    } catch {
      return null;
    }
  });
}

/** The national event rail (`events.json`), or null. Call only when the index lists it. */
export function loadEvents(fetcher: typeof fetch = fetch): Promise<EventsOutput | null> {
  return optional('events.json', (raw) => parseWith(EventsOutputSchema, raw, 'events.json'), fetcher);
}

/** The weekly pulse (`pulse.json`), or null. Call only when the index lists it. */
export function loadPulse(fetcher: typeof fetch = fetch): Promise<PulseOutput | null> {
  return optional('pulse.json', (raw) => parseWith(PulseOutputSchema, raw, 'pulse.json'), fetcher);
}

/** One metro's counties (`areas/<slug>.json`), or null. Call only for slugs the index lists. */
export function loadArea(slug: string, fetcher: typeof fetch = fetch): Promise<AreasOutput | null> {
  if (!isValidSlug(slug)) return Promise.resolve(null);
  const path = `areas/${slug}.json`;
  return optional(path, (raw) => parseWith(AreasOutputSchema, raw, path), fetcher);
}

/** A region's ZIP/city market (`regions/<slug>.json`, v3 §4.2), or null. Call only for regions the index lists. */
export function loadRegion(slug: string, fetcher: typeof fetch = fetch): Promise<RegionOutput | null> {
  if (!isValidSlug(slug)) return Promise.resolve(null);
  const path = `regions/${slug}.json`;
  return optional(path, (raw) => parseWith(RegionOutputSchema, raw, path), fetcher);
}

/** A region's ZIP and city shapes (`regions/<slug>.geo.json`), or null. */
export function loadRegionGeometry(slug: string, fetcher: typeof fetch = fetch): Promise<RegionGeometry | null> {
  if (!isValidSlug(slug)) return Promise.resolve(null);
  const path = `regions/${slug}.geo.json`;
  return optional(path, (raw) => parseWith(RegionGeometrySchema, raw, path), fetcher);
}
