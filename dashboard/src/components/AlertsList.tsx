import { Link } from 'react-router-dom';
import { Badge } from './ui/Badge';
import { severityTone } from './ui/tones';
import { EmptyState } from './ui/StateViews';

export interface AlertView {
  flag: string;
  label: string;
  severity: string;
  metros: readonly { slug: string; name: string; label: string; severity: string }[];
}

/** Alert groups (notable/major flags by id), each metro with its own figure (SPEC §6.3). */
export function AlertsList({ alerts }: { alerts: readonly AlertView[] }) {
  if (alerts.length === 0) return <EmptyState>No notable or major flags this month.</EmptyState>;
  return (
    <ul className="space-y-4">
      {alerts.map((alert) => (
        <li key={alert.flag}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{alert.label}</h3>
            <Badge tone={severityTone(alert.severity)}>{alert.severity}</Badge>
            <span className="text-sm muted">
              {alert.metros.length} {alert.metros.length === 1 ? 'metro' : 'metros'}
            </span>
          </div>
          <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {alert.metros.map((m) => (
              <li key={m.slug} className="flex items-baseline justify-between gap-2">
                <Link to={`/metro/${m.slug}`} className="min-w-0 truncate">
                  {m.name}
                </Link>
                <span className="whitespace-nowrap tabular-nums muted">{m.label}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
