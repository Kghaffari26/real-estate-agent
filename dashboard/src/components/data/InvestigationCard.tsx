import { ArrowUpRight, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDateTime } from '../../lib/format';
import { triggerText } from '../../lib/labels';
import { Badge } from '../ui/Badge';
import { NarrativeBadge } from './AnalystNote';

export interface InvestigationView {
  slug: string;
  name: string;
  triggerLabel: string;
  triggerKind: 'new_major_flag' | 'top_mover';
  text: string;
  citedMetrics: readonly { key: string; label: string }[];
  narrativeSource: 'llm' | 'template';
  reused?: boolean;
  stopReason: string;
  steps?: number | null;
  toolsCalled?: readonly string[];
  generatedAt?: string | null;
}

/** Overview card: the investigation summary, linking to the metro. */
export function InvestigationTeaser({ view }: { view: InvestigationView }) {
  return (
    <Link to={`/metro/${view.slug}?section=investigation`} className="card group flex h-full flex-col gap-3 p-4 text-text no-underline transition-shadow duration-2 hover:shadow-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="eyebrow">{triggerText(view.triggerKind)}</p>
          <h3 className="mt-1 text-md font-semibold">{view.name}</h3>
        </div>
        <ArrowUpRight aria-hidden="true" className="h-4 w-4 text-text-3 transition-transform duration-1 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
      <p className="num text-sm font-medium text-text-2">{view.triggerLabel}</p>
      <p className="text-sm leading-relaxed text-text-2">{view.text}</p>
      <div className="mt-auto flex flex-wrap gap-1">
        {view.citedMetrics.slice(0, 4).map((m) => (
          <Badge key={m.key} tone="outline">
            {m.label}
          </Badge>
        ))}
      </div>
    </Link>
  );
}

/** Metro page: the full "Why this is happening" explanation. Hovering a cited chip highlights its KPI. */
export function InvestigationBody({ view, onHoverMetric }: { view: InvestigationView; onHoverMetric?: (key: string | null) => void }) {
  const meta = [
    view.steps ? `${view.steps} steps` : null,
    view.toolsCalled?.length ? `${new Set(view.toolsCalled).size} tools` : null,
    view.stopReason !== 'finished' ? `stopped: ${view.stopReason}` : null,
    view.generatedAt ? formatDateTime(view.generatedAt) : null,
  ].filter(Boolean);
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="outline">
          <Search aria-hidden="true" className="h-3 w-3" />
          {triggerText(view.triggerKind)}: <span className="num">{view.triggerLabel}</span>
        </Badge>
        <NarrativeBadge source={view.narrativeSource} reused={view.reused} />
      </div>
      <p className="text-md leading-relaxed text-text">{view.text}</p>
      {view.citedMetrics.length > 0 && (
        <div>
          <p className="eyebrow mb-2">Cited metrics</p>
          <ul className="flex flex-wrap gap-1.5">
            {view.citedMetrics.map((m) => (
              <li key={m.key}>
                <a
                  href={`#kpi-${m.key}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.querySelector(`[data-metric="${m.key}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                  }}
                  onMouseEnter={() => onHoverMetric?.(m.key)}
                  onMouseLeave={() => onHoverMetric?.(null)}
                  onFocus={() => onHoverMetric?.(m.key)}
                  onBlur={() => onHoverMetric?.(null)}
                  className="chip border-accent/30 bg-accent-soft text-accent no-underline hover:border-accent"
                >
                  {m.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {meta.length > 0 && <p className="mt-auto border-t border-border pt-3 text-2xs text-text-3">{meta.join(' · ')}</p>}
    </div>
  );
}
