/**
 * Schemas for the two files that aren't in schemas/real_estate.schema.json:
 * - manifest-entry.json: agents-core's runner output (its data-branch contract);
 * - source.json: written by scripts/fetch-data.mjs to say where the data came from.
 * Both are parsed as tolerantly as the generated contract.
 */
import { z } from 'zod';
import { KeyStatSchema } from './schema.gen';
import { optionalField, tolerantArray } from './tolerant';

export const TraceSummarySchema = z.object({
  steps: optionalField(z.number(), null, 'trace_summary.steps'),
  tool_calls: optionalField(z.number(), null, 'trace_summary.tool_calls'),
  llm_calls: optionalField(z.number(), null, 'trace_summary.llm_calls'),
  total_latency_ms: optionalField(z.number(), null, 'trace_summary.total_latency_ms'),
  cost_usd: optionalField(z.number(), null, 'trace_summary.cost_usd'),
  guard_retries: optionalField(z.number(), null, 'trace_summary.guard_retries'),
});

export const ManifestEntrySchema = z.object({
  id: z.string(),
  name: optionalField(z.string(), null, 'manifest.name'),
  status: optionalField(z.string(), null, 'manifest.status'),
  last_run_at: optionalField(z.string(), null, 'manifest.last_run_at'),
  last_data_change_at: optionalField(z.string(), null, 'manifest.last_data_change_at'),
  expected_interval_hours: optionalField(z.number(), null, 'manifest.expected_interval_hours'),
  next_run_hint: optionalField(z.string(), null, 'manifest.next_run_hint'),
  headline: optionalField(z.string(), null, 'manifest.headline'),
  key_stats: optionalField(tolerantArray(KeyStatSchema, 'manifest.key_stats'), [], 'manifest.key_stats'),
  run_cost_usd: optionalField(z.number(), null, 'manifest.run_cost_usd'),
  items_count: optionalField(z.number(), null, 'manifest.items_count'),
  trace_summary: optionalField(TraceSummarySchema.nullable(), null, 'manifest.trace_summary'),
});
export type ManifestEntry = z.output<typeof ManifestEntrySchema>;

export const DataSourceSchema = z.object({
  source: z.enum(['data-branch', 'sample', 'local']),
  fetched_at: optionalField(z.string(), null, 'source.fetched_at'),
  detail: optionalField(z.string(), null, 'source.detail'),
});
export type DataSource = z.output<typeof DataSourceSchema>;
