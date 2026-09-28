import type { Citation } from '../../data/schema.gen';
import { BRAND } from '../../config/brand';
import { LogoMark } from '../brand/Logo';

interface FooterProps {
  sources: readonly Citation[];
  dataThrough: string;
  lastUpdated: string;
}

export function Footer({ sources, dataThrough, lastUpdated }: FooterProps) {
  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-8 text-xs text-text-3 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-text">
            <LogoMark className="h-5 w-5" />
            {BRAND.name}
          </span>
          <p className="num">
            Data through <strong className="font-medium text-text-2">{dataThrough}</strong> · Last updated <strong className="font-medium text-text-2">{lastUpdated}</strong>
          </p>
        </div>
        {sources.length > 0 && (
          <ul className="grid gap-1 sm:grid-cols-2">
            {sources.map((s) => (
              <li key={s.name}>
                <a href={s.url} target="_blank" rel="noreferrer noopener" className="font-medium">
                  {s.name}
                </a>
                {s.attribution ? ` — ${s.attribution}` : ''}
              </li>
            ))}
          </ul>
        )}
        <p>Every number is computed in code from the sources above; AI writes only the narrative, and each figure it cites is checked before publishing.</p>
      </div>
    </footer>
  );
}
