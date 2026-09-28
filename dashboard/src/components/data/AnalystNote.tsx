import { ExternalLink, Sparkles } from 'lucide-react';
import type { Brief } from '../../data/schema.gen';
import { formatDateTime } from '../../lib/format';
import { Badge } from '../ui/Badge';

export function NarrativeBadge({ source, reused }: { source: 'llm' | 'template'; reused?: boolean }) {
  return (
    <span className="flex flex-wrap gap-1">
      {source === 'llm' ? (
        <Badge tone="accent" title="Written by AI from the computed facts; every number it cites is checked against them">
          <Sparkles aria-hidden="true" className="h-3 w-3" />
          AI-written
        </Badge>
      ) : (
        <Badge title="A deterministic template (the AI text was unavailable or failed its checks)">Template</Badge>
      )}
      {reused && <Badge title="The facts didn't change since the last run, so the text was reused">Reused</Badge>}
    </span>
  );
}

export function SourceChips({ citations }: { citations: Brief['citations'] }) {
  if (!citations.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Sources">
      {citations.map((c) => (
        <li key={c.url + c.name}>
          <a href={c.url} target="_blank" rel="noreferrer noopener" className="chip gap-1 border-border bg-surface-2 text-text-2 no-underline hover:border-border-strong hover:text-text">
            {c.name}
            <ExternalLink aria-hidden="true" className="h-3 w-3" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The AI brief, presented as an analyst note: text, key points, source chips. */
export function AnalystNote({ brief, compact = false }: { brief: Brief; compact?: boolean }) {
  return (
    <div className="flex h-full flex-col gap-4">
      <p className={`leading-relaxed text-text ${compact ? 'text-sm' : 'text-md'}`}>{brief.text}</p>
      {brief.key_points.length > 0 && (
        <ul className="space-y-2">
          {brief.key_points.map((p) => (
            <li key={p} className="flex gap-2.5 text-sm text-text-2">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              {p}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <SourceChips citations={brief.citations} />
        <p className="text-2xs text-text-3">
          {formatDateTime(brief.generated_at)}
          {brief.model ? ` · ${brief.model}` : ''}
        </p>
      </div>
    </div>
  );
}
