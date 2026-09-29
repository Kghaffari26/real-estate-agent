/**
 * The weekly pulse (agent §6.6) as a ticker under the hero: every metro's latest
 * rolling 4-week median sale price and its YoY, fastest first, each linking to its
 * dossier. It drifts slowly and pauses on hover, focus, its own pause button and the
 * page's media pause; under reduced motion it's a still, scrollable row.
 */
import { Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { signOf } from '../atlas/format';
import { formatDate, formatDelta, formatValue } from '../lib/format';
import { metroPath } from '../ui/atlasState';
import { MiniSpark } from '../ui/dataviz';
import type { TickerItem } from '../viewmodels/pulse';

interface PulseTickerProps {
  items: readonly TickerItem[];
  windowWeeks: number;
  through: string;
  still: boolean;
}

function Item({ it, hidden = false }: { it: TickerItem; hidden?: boolean }) {
  const tone = signOf(it.yoy) > 0 ? 'text-mp-hot-2' : signOf(it.yoy) < 0 ? 'text-mp-cool-2' : 'text-mp-ink-2';
  return (
    <li className="flex-none" aria-hidden={hidden || undefined}>
      <Link
        to={metroPath(it.slug)}
        tabIndex={hidden ? -1 : undefined}
        className="flex items-center gap-3 rounded-control px-3 py-2 text-sm text-mp-ink no-underline hover:bg-mp-ink/[.05]"
      >
        <span className="whitespace-nowrap">{it.name.replace(/,\s*[A-Z-]+$/, '')}</span>
        <MiniSpark values={it.spark} width={44} height={16} marks={false} />
        <span className="mp-num whitespace-nowrap text-mp-ink-2">{formatValue(it.price, 'currency_compact')}</span>
        <span className={`mp-num whitespace-nowrap ${tone}`}>
          {formatDelta(it.yoy, 'percent_signed')}
          <span className="sr-only"> year over year</span>
        </span>
      </Link>
    </li>
  );
}

export function PulseTicker({ items, windowWeeks, through, still }: PulseTickerProps) {
  const [paused, setPaused] = useState(false);
  if (!items.length) return null;
  const moving = !still;
  return (
    <section aria-labelledby="pulse-h" className="relative border-y border-mp-line bg-mp-panel/40" data-testid="pulse-ticker">
      <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 pt-3 sm:px-8">
        <h2 id="pulse-h" className="mp-label text-mp-accent">
          The weekly pulse
        </h2>
        <p className="text-xs text-mp-ink-3">
          Median sale price, {windowWeeks} weeks ending {formatDate(through)}, vs a year earlier · Redfin
        </p>
        <span className="flex-1" />
        {moving && (
          <button
            type="button"
            onClick={() => setPaused(!paused)}
            className="grid h-8 w-8 place-items-center rounded-control text-mp-ink-3 hover:bg-mp-ink/[.06] hover:text-mp-ink"
            aria-label={paused ? 'Play the pulse ticker' : 'Pause the pulse ticker'}
            aria-pressed={paused}
          >
            {paused ? <Play size={14} strokeWidth={1.5} aria-hidden="true" /> : <Pause size={14} strokeWidth={1.5} aria-hidden="true" />}
          </button>
        )}
      </div>
      <div className={`mp-marquee-host relative py-1 ${moving ? 'overflow-hidden' : 'overflow-x-auto'}`} tabIndex={moving ? undefined : 0} role={moving ? undefined : 'region'} aria-label={moving ? undefined : 'Weekly pulse by metro'}>
        <ul className={`flex w-max ${moving ? 'mp-marquee' : 'px-2 sm:px-6'}`} data-paused={paused || undefined} style={{ ['--mp-marquee-dur' as string]: `${items.length * 3.2}s` }} aria-label="Metros by weekly price change">
          {items.map((it) => (
            <Item key={it.slug} it={it} />
          ))}
          {moving && items.map((it) => <Item key={`${it.slug}-2`} it={it} hidden />)}
        </ul>
      </div>
    </section>
  );
}
