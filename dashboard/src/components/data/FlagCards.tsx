import { severityLabel, severityStatus } from '../../lib/labels';
import { StatusBadge, StatusIcon } from '../ui/Status';
import { EmptyState } from '../ui/StateViews';

export interface FlagView {
  id: string;
  label: string;
  severity: string;
  facts: readonly { label: string; value: string }[];
}

export function FlagCards({ flags }: { flags: readonly FlagView[] }) {
  if (!flags.length) return <EmptyState compact title="No flags this month">None of the rules fired for this metro.</EmptyState>;
  const order = { major: 0, notable: 1, info: 2 } as Record<string, number>;
  return (
    <ul className="space-y-2">
      {[...flags]
        .sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3))
        .map((f) => {
          const status = severityStatus(f.severity);
          return (
            <li key={f.id} className="well flex items-start gap-3 p-3">
              <StatusIcon status={status} className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{f.label}</p>
                  <StatusBadge status={status}>{severityLabel(f.severity)}</StatusBadge>
                </div>
                {f.facts.length > 0 && (
                  <dl className="mt-1 flex flex-wrap gap-x-4 text-xs text-text-3">
                    {f.facts.map((fact) => (
                      <div key={fact.label} className="flex gap-1">
                        <dt>{fact.label}</dt>
                        <dd className="num font-medium text-text-2">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </li>
          );
        })}
    </ul>
  );
}
