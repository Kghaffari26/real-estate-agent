/**
 * Tolerant-parsing building blocks used by the generated `schema.gen.ts`.
 *
 * The contract (schemas/real_estate.schema.json) only ever grows additively, so the
 * dashboard must accept older files (fields missing) and survive a single bad item
 * (dropped with a console warning) instead of crashing the whole view.
 */
import { z } from 'zod';

type Warner = (message: string) => void;

let warn: Warner = (message) => console.warn(`[data] ${message}`);

/** Tests swap the warning sink to assert on it. */
export function setWarner(fn: Warner | null): void {
  warn = fn ?? ((message) => console.warn(`[data] ${message}`));
}

function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/** An array whose malformed items are dropped (with a warning) rather than failing the parent. */
export function tolerantArray<T extends z.ZodTypeAny>(item: T, where: string) {
  return z.array(z.unknown()).transform((items) => {
    const out: z.output<T>[] = [];
    items.forEach((raw, index) => {
      const parsed = item.safeParse(raw);
      if (parsed.success) out.push(parsed.data as z.output<T>);
      else warn(`${where}[${index}] dropped: ${describe(parsed.error)}`);
    });
    return out;
  });
}

/** A string-keyed map whose malformed entries are dropped (with a warning). */
export function tolerantRecord<T extends z.ZodTypeAny>(value: T, where: string) {
  return z.record(z.string(), z.unknown()).transform((entries) => {
    const out: Record<string, z.output<T>> = {};
    for (const [key, raw] of Object.entries(entries)) {
      const parsed = value.safeParse(raw);
      if (parsed.success) out[key] = parsed.data as z.output<T>;
      else warn(`${where}.${key} dropped: ${describe(parsed.error)}`);
    }
    return out;
  });
}

/**
 * A field that isn't required by the contract: missing → `fallback` silently (older
 * data), present but malformed → `fallback` with a warning.
 */
export function optionalField<T extends z.ZodTypeAny>(
  schema: T,
  fallback: z.output<T>,
  where: string,
): z.ZodEffects<z.ZodUnknown, z.output<T>, unknown>;
export function optionalField<T extends z.ZodTypeAny, D extends null | undefined>(
  schema: T,
  fallback: D,
  where: string,
): z.ZodEffects<z.ZodUnknown, z.output<T> | D, unknown>;
export function optionalField<T extends z.ZodTypeAny>(schema: T, fallback: unknown, where: string) {
  return z.unknown().transform((raw): unknown => {
    if (raw === undefined) return fallback;
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    warn(`${where} replaced with its default: ${describe(parsed.error)}`);
    return fallback;
  });
}

/** A numeric series element: anything that isn't a finite number becomes null. */
export const seriesNumber = z.unknown().transform((raw) =>
  typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
);

type AnyObject = z.ZodObject<z.ZodRawShape>;

/**
 * `anyOf` over object shapes. zod's `z.union` returns the first match and strips keys
 * it doesn't know, so `{value, yoy_12m}` (PermitsValue) would parse as a MetricValue
 * and lose `yoy_12m`. This picks the matching option that declares the most of the
 * input's keys, which is what the contract means.
 */
export function bestUnion<T extends readonly [AnyObject, AnyObject, ...AnyObject[]]>(options: T) {
  return z.unknown().transform((raw, ctx): z.output<T[number]> => {
    const keys = raw && typeof raw === 'object' ? Object.keys(raw) : [];
    let best: { score: number; data: unknown } | null = null;
    for (const option of options) {
      const parsed = option.safeParse(raw);
      if (!parsed.success) continue;
      const score = keys.filter((key) => key in option.shape).length;
      if (!best || score > best.score) best = { score, data: parsed.data };
    }
    if (!best) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'matches none of the allowed shapes' });
      return z.NEVER;
    }
    return best.data as z.output<T[number]>;
  });
}
