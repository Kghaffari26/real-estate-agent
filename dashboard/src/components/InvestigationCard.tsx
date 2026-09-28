import { Link } from 'react-router-dom';
import { formatDateTime } from '../lib/format';
import { triggerText } from '../lib/labels';
import { NarrativeBadge } from './BriefCard';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';

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


/** The investigator's "why this is happening" explanation (SPEC §6.3). */
export function InvestigationCard({ view, id, linkToMetro }: { view: InvestigationView; id: string; linkToMetro?: boolean }) {
  const footer = [
    view.steps ? `${view.steps} steps` : null,
    view.toolsCalled?.length ? `tools: ${[...new Set(view.toolsCalled)].join(', ')}` : null,
    view.stopReason !== 'finished' ? `stopped: ${view.stopReason}` : null,
    view.generatedAt ? `generated ${formatDateTime(view.generatedAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card
      id={id}
      level={linkToMetro ? 3 : 2}
      title={linkToMetro ? <Link to={`/metro/${view.slug}`}>{view.name}</Link> : 'Why this is happening'}
      actions={
        <>
          <Badge tone="info">{triggerText(view.triggerKind)}</Badge>
          <NarrativeBadge source={view.narrativeSource} reused={view.reused} />
        </>
      }
      footer={footer || undefined}
    >
      <p className="text-sm font-medium">{view.triggerLabel}</p>
      <p className="mt-2 leading-relaxed">{view.text}</p>
      {view.citedMetrics.length > 0 && (
        <div className="mt-3">
          <h4 className="text-sm font-semibold">Cited metrics</h4>
          <ul className="mt-1 flex flex-wrap gap-1">
            {view.citedMetrics.map((m) => (
              <li key={m.key}>
                <Badge>{m.label}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
