import { Link } from 'react-router-dom';
import { severityLabel, severityStatus } from '../../lib/labels';
import { StatusBadge, StatusIcon } from '../ui/Status';
import { EmptyState } from '../ui/StateViews';

export interface AlertView {
  flag: string;
  label: string;
  severity: string;
  metros: readonly { slug: string; name: string; label: string; severity: string }[];
}

/** One card per alert group (a flag across metros); each metro shows its own figure. */
export function AlertCards({ alerts }: { alerts: readonly AlertView[] }) {
  if (alerts.length === 0) return <EmptyState title="No alerts this month">No notable or major flags fired in any metro.</EmptyState>;
  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {alerts.map((alert) => {
        const status = severityStatus(alert.severity);
        const shown = alert.metros.slice(0, 8);
        return (
          <li key={alert.flag} className="card flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <StatusIcon status={status} className="mt-0.5 h-4 w-4 shrink-0" />
                <h3 className="text-sm font-semibold leading-5">{alert.label}</h3>
              </div>
              <StatusBadge status={status}>{severityLabel(alert.severity)}</StatusBadge>
            </div>
            <p className="num mt-1 pl-6 text-xs text-text-3">
              {alert.metros.length} {alert.metros.length === 1 ? 'metro' : 'metros'}
            </p>
            <ul className="mt-3 space-y-1.5 pl-6 text-sm">
              {shown.map((m) => (
                <li key={m.slug} className="flex items-baseline justify-between gap-3">
                  <Link to={`/metro/${m.slug}`} className="min-w-0 truncate text-text no-underline hover:underline">
                    {m.name}
                  </Link>
                  <span className="num shrink-0 text-xs text-text-2">{m.label.replace(/^.*?([+−-]?\d[\d.,]*%?.*)$/, '$1')}</span>
                </li>
              ))}
            </ul>
            {alert.metros.length > shown.length && (
              <Link to={`/metros?flag=${alert.flag}`} className="mt-3 pl-6 text-xs">
                +{alert.metros.length - shown.length} more in the metros table
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
