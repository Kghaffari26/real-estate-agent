import type { Status } from '../components/ui/Status';

/** Display labels for enum values in the contract. */
export function triggerText(kind: 'new_major_flag' | 'top_mover'): string {
  return kind === 'new_major_flag' ? 'New major flag' : 'Top mover';
}

/** Flag/alert severity → status (info stays neutral; notable = warning; major = bad). */
export function severityStatus(severity: string): Status {
  return severity === 'major' ? 'bad' : severity === 'notable' ? 'warning' : 'info';
}

export function severityLabel(severity: string): string {
  return severity === 'major' ? 'Major' : severity === 'notable' ? 'Notable' : 'Info';
}

/** The agent's staleness warning (agents/real_estate/compute.py:source_lag_warning). */
export function isStale(warnings: readonly string[]): boolean {
  return warnings.some((w) => w.startsWith('Redfin data runs through'));
}
