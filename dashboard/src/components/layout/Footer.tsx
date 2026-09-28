import type { Citation } from '../../data/schema.gen';

interface FooterProps {
  sources: readonly Citation[];
  dataThrough: string;
  lastUpdated: string;
}

export function Footer({ sources, dataThrough, lastUpdated }: FooterProps) {
  return (
    <footer className="mt-12 border-t border-border bg-surface">
      <div className="mx-auto max-w-7xl space-y-2 px-4 py-6 text-sm muted">
        <p>
          Data through <strong className="text-text">{dataThrough}</strong> · Last updated{' '}
          <strong className="text-text">{lastUpdated}</strong>
        </p>
        {sources.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {sources.map((s) => (
              <li key={s.name}>
                <a href={s.url} target="_blank" rel="noreferrer noopener">
                  {s.name}
                </a>
                {s.attribution ? ` — ${s.attribution}` : ''}
              </li>
            ))}
          </ul>
        )}
        <p>Every number is computed in code from the sources above; AI only writes the narrative text.</p>
      </div>
    </footer>
  );
}
