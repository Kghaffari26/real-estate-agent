import type { Brief } from '../data/schema.gen';
import { formatDateTime } from '../lib/format';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { Citations } from './Citations';

export function NarrativeBadge({ source, reused }: { source: 'llm' | 'template'; reused?: boolean }) {
  return (
    <>
      <Badge tone={source === 'llm' ? 'accent' : 'neutral'} title={source === 'llm' ? 'Written by an AI model from computed facts; every number is checked against them' : 'Deterministic template'}>
        {source === 'llm' ? 'AI-written narrative' : 'Template narrative'}
      </Badge>
      {reused && <Badge title="Facts unchanged since the last run, so the text was reused">Reused</Badge>}
    </>
  );
}

export function BriefCard({ title, brief, id }: { title: string; brief: Brief; id: string }) {
  return (
    <Card
      id={id}
      title={title}
      actions={<NarrativeBadge source={brief.narrative_source} reused={brief.reused} />}
      footer={`Generated ${formatDateTime(brief.generated_at)}${brief.model ? ` · ${brief.model}` : ''}`}
    >
      <p className="leading-relaxed">{brief.text}</p>
      {brief.key_points.length > 0 && (
        <>
          <h3 className="mt-3 text-sm font-semibold">Key points</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {brief.key_points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </>
      )}
      <Citations citations={brief.citations} />
    </Card>
  );
}
