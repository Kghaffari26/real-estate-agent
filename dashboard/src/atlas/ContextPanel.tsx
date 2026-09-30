import { ArrowRight, BarChart3, Crosshair, MousePointerClick, Share2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { MetricRegistryEntry } from '../data/schema.gen';
import { formatMonth, formatValue } from '../lib/format';
import type { AreaResult, CountyResult } from '../lib/area';
import { RADIUS_MAX, RADIUS_MIN } from '../lib/area';
import { Button, Chip, Slider } from '../ui/controls';
import { MiniSpark } from '../ui/dataviz';
import type { AtlasMetro } from '../viewmodels/atlas';
import { metroPath } from '../ui/atlasState';
import { fmtChange, fmtMetric, TEMPERATURE_ORDER, TEMPERATURE_TONE, toneClass } from './format';

const REG_PRICE = { key: 'median_sale_price', format: 'currency', change_kind: 'ratio' } as MetricRegistryEntry;
const REG_INV = { key: 'inventory', format: 'count', change_kind: 'ratio' } as MetricRegistryEntry;

// ---------- area search ----------

/** The counties inside the ring (agent §6.7): count, weighted median and the busiest few. */
function CountyBlock({ counties, radiusMi, title = 'Counties inside', note, testId = 'area-counties' }: { counties: CountyResult; radiusMi: number; title?: string; note?: string; testId?: string }) {
  const n = counties.counties.length;
  return (
    <div className="mt-5 border-t border-mp-line pt-4" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="mp-label">{title}</div>
        <div className="mp-num text-xs text-mp-ink-3" data-testid={`${testId}-count`}>
          {n}
        </div>
      </div>
      {n === 0 ? (
        <p className="mt-2 text-sm text-mp-ink-2">No {title.toLowerCase().replace(' inside', '')} centers within {Math.round(radiusMi)} miles.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-mp-ink-2">
            <span className="mp-num text-mp-ink" data-testid={`${testId}-price`}>
              {formatValue(counties.price, 'currency_compact')}
            </span>{' '}
            weighted median ·{' '}
            <span className={`mp-num ${toneClass(counties.yoy)}`}>{fmtChange(REG_PRICE, counties.yoy)}</span> YoY
          </p>
          <ul className="mt-2 space-y-1 text-[13px]">
            {counties.counties.slice(0, 5).map((c) => (
              <li key={c.name} className="flex items-baseline justify-between gap-3">
                <span className="truncate text-mp-ink">{c.name}</span>
                <span className="mp-num flex-none text-mp-ink-2">
                  {formatValue(c.price, 'currency_compact')} <span className={toneClass(c.yoy)}>{fmtChange(REG_PRICE, c.yoy)}</span>
                </span>
              </li>
            ))}
          </ul>
          {n > 5 && <p className="mt-1 text-xs text-mp-ink-3">+{n - 5} more counties</p>}
          <p className="mt-2 text-[11px] leading-4 text-mp-ink-3">
            {note ?? `Redfin county data, weighted by the latest month's homes sold (${formatValue(counties.homesSold, 'count')}); a county counts when its center is inside the ring.`}
          </p>
        </>
      )}
    </div>
  );
}
export function AreaPanel({
  area,
  counties = null,
  zips = null,
  label,
  dataThrough,
  onRadius,
  onClear,
  onShare,
  onSelect,
}: {
  area: AreaResult;
  /** §6.7 counties inside the ring; null when the agent hasn't published county files. */
  counties?: CountyResult | null;
  /** v3 R2: ZIP codes of a loaded region inside the ring. */
  zips?: CountyResult | null;
  label: string;
  dataThrough: string;
  onRadius: (r: number) => void;
  onClear: () => void;
  onShare: () => void;
  onSelect: (slug: string) => void;
}) {
  const temps = TEMPERATURE_ORDER.filter((k) => area.temperatures[k]);
  const n = area.metros.length;
  return (
    <section aria-labelledby="area-h" data-testid="area-panel">
      <div className="flex items-center gap-2">
        <span className="mp-label flex items-center gap-2 text-mp-accent">
          <Crosshair size={14} strokeWidth={1.5} aria-hidden="true" /> Area search
        </span>
        <span className="flex-1" />
        <button type="button" onClick={onShare} className="rounded-control p-1.5 text-mp-ink-3 hover:bg-mp-ink/[.06] hover:text-mp-ink" aria-label="Copy a link to this area">
          <Share2 size={15} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button type="button" onClick={onClear} className="rounded-control p-1.5 text-mp-ink-3 hover:bg-mp-ink/[.06] hover:text-mp-ink" aria-label="Clear the area search">
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <h2 id="area-h" className="mp-display mt-2 text-[27px] leading-[1.05]">
        {Math.round(area.radiusMi)} mi around
        <br />
        {label}
      </h2>
      <Slider className="mt-3" label="Radius" value={area.radiusMi} min={RADIUS_MIN} max={RADIUS_MAX} step={5} scale="log" onChange={onRadius} format={(v) => `${Math.round(v)} mi`} ends={['10', '250 mi']} />
      {n === 0 ? (
        <p className="mt-4 border-t border-mp-line pt-4 text-sm text-mp-ink-2" role="status">
          None of the 50 tracked metros is within {Math.round(area.radiusMi)} miles. Widen the ring or drop the pin closer to a city.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-mp-line pt-4" aria-live="polite">
            <div>
              <div className="mp-label">Median price, weighted</div>
              <div className="mp-num-hero mt-1 text-[28px]" data-testid="area-price">
                {formatValue(area.price, 'currency_compact')}
              </div>
              <div className="mp-num text-[13px]">
                <span className={toneClass(area.yoy)} data-testid="area-yoy">
                  {fmtChange(REG_PRICE, area.yoy)}
                </span>{' '}
                <span className="font-ui text-mp-ink-3">YoY</span>
              </div>
            </div>
            <div>
              <div className="mp-label">Active inventory</div>
              <div className="mp-num-hero mt-1 text-[28px]" data-testid="area-inventory">
                {fmtMetric(REG_INV, area.inventory)}
              </div>
              <div className="text-[13px] text-mp-ink-3" data-testid="area-count">
                {n} {n === 1 ? 'metro' : 'metros'} inside
              </div>
            </div>
          </div>
          <div className="mt-4">
            <div className="mp-label">Temperature mix</div>
            <div className="mt-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
              {temps.map((k) => (
                <div key={k} className={TEMPERATURE_TONE[k]} style={{ flex: area.temperatures[k] }} />
              ))}
            </div>
            <ul className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-mp-ink-2">
              {temps.map((k) => (
                <li key={k} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-sm ${TEMPERATURE_TONE[k]}`} aria-hidden="true" />
                  {k} {area.temperatures[k]}
                </li>
              ))}
            </ul>
          </div>
          <table className="mt-3 w-full text-[13px]">
            <caption className="sr-only">Metros inside the ring</caption>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[.06em] text-mp-ink-3">
                <th scope="col" className="py-1.5 font-medium">
                  Metro
                </th>
                <th scope="col" className="text-right font-medium">
                  mi
                </th>
                <th scope="col" className="text-right font-medium">
                  Median
                </th>
                <th scope="col" className="text-right font-medium">
                  YoY
                </th>
              </tr>
            </thead>
            <tbody>
              {area.metros.slice(0, 8).map((m) => (
                <tr key={m.slug} className="border-t border-mp-line">
                  <td className="py-1.5">
                    <button type="button" onClick={() => onSelect(m.slug)} className="text-left text-mp-ink hover:text-mp-accent">
                      {m.name}
                    </button>
                  </td>
                  <td className="mp-num text-right text-mp-ink-3">{Math.round(m.miles)}</td>
                  <td className="mp-num text-right">{formatValue(m.price, 'currency_compact')}</td>
                  <td className={`mp-num text-right ${toneClass(m.yoy)}`}>{fmtChange(REG_PRICE, m.yoy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {n > 8 && <p className="mt-1 text-xs text-mp-ink-3">+{n - 8} more in the table view</p>}
          <p className="mt-3 text-[11px] leading-4 text-mp-ink-3">
            Weighted by homes sold over 12 months ({formatValue(area.homesSold12m, 'count')} sales), as of {formatMonth(dataThrough, true)}.
          </p>
        </>
      )}
      {counties && <CountyBlock counties={counties} radiusMi={area.radiusMi} />}
      {zips && (
        <CountyBlock
          counties={zips}
          radiusMi={area.radiusMi}
          title="ZIP codes inside"
          testId="area-zips"
          note={`Redfin ZIP data (rolling 3 months), weighted by homes sold (${formatValue(zips.homesSold, 'count')}); a ZIP counts when its center is inside the ring.`}
        />
      )}
    </section>
  );
}

// ---------- selected metro(s) ----------
export function MetroPanel({
  metros,
  metric,
  monthLabel,
  values,
  onClear,
  onAround,
  onFly,
}: {
  metros: readonly AtlasMetro[];
  metric: MetricRegistryEntry;
  monthLabel: string;
  /** The metric's value and change at the scrubbed month, per slug. */
  values: Record<string, { value: number | null; change: number | null }>;
  onClear: () => void;
  onAround: (m: AtlasMetro) => void;
  onFly: (m: AtlasMetro) => void;
}) {
  if (metros.length > 1) {
    const slugs = metros.map((m) => m.slug);
    return (
      <section aria-labelledby="sel-h" data-testid="selection-panel">
        <div className="flex items-center">
          <span className="mp-label text-mp-accent">Lasso selection</span>
          <span className="flex-1" />
          <button type="button" onClick={onClear} className="rounded-control p-1.5 text-mp-ink-3 hover:text-mp-ink" aria-label="Clear the selection">
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        <h2 id="sel-h" className="mp-display mt-2 text-[27px]">
          {metros.length} metros selected
        </h2>
        <ul className="mt-3 space-y-1 text-sm">
          {metros.slice(0, 3).map((m) => (
            <li key={m.slug} className="flex justify-between gap-3 border-t border-mp-line pt-1.5">
              <span>{m.name}</span>
              <span className={`mp-num ${toneClass(values[m.slug]?.change)}`}>{fmtMetric(metric, values[m.slug]?.value)}</span>
            </li>
          ))}
        </ul>
        {metros.length > 3 && <p className="mt-2 text-xs text-mp-ink-3">Compare takes the 3 largest by homes sold.</p>}
        <Link to={`/compare?m=${slugs.slice(0, 3).join(',')}`} className="mt-4 inline-flex h-10 items-center gap-2 rounded-control bg-mp-accent px-4 text-sm font-medium text-mp-accent-ink no-underline">
          <BarChart3 size={15} strokeWidth={1.5} aria-hidden="true" /> Compare selected
        </Link>
      </section>
    );
  }
  const m = metros[0]!;
  const v = values[m.slug];
  const stat = (key: string, label: string, entry: Partial<MetricRegistryEntry>) => (
    <div>
      <dt className="text-xs text-mp-ink-3">{label}</dt>
      <dd className="mp-num text-[15px] text-mp-ink">{fmtMetric(entry as MetricRegistryEntry, m.latest[key]?.value)}</dd>
    </div>
  );
  return (
    <section aria-labelledby="sel-h" data-testid="metro-panel">
      <div className="flex items-center gap-2">
        {m.temperatureLabel && (
          <Chip dot tone={m.temperature != null && m.temperature >= 50 ? 'hot' : 'cool'}>
            {m.temperatureLabel} {m.temperature}
          </Chip>
        )}
        {m.marketType && <Chip>{m.marketType}</Chip>}
        <span className="flex-1" />
        <button type="button" onClick={onClear} className="rounded-control p-1.5 text-mp-ink-3 hover:text-mp-ink" aria-label="Clear the selection">
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <h2 id="sel-h" className="mp-display mt-2 text-[34px] leading-none">
        {m.name}
      </h2>
      <div className="mt-3">
        <div className="mp-label">
          {metric.label} · {monthLabel}
        </div>
        <div className="mp-num-hero mt-1 text-[34px]" data-testid="metro-value">
          {fmtMetric(metric, v?.value)}
        </div>
        <div className="mp-num text-[13px]">
          <span className={toneClass(v?.change)} data-testid="metro-change">
            {fmtChange(metric, v?.change)}
          </span>{' '}
          <span className="font-ui text-mp-ink-3">YoY</span>
        </div>
      </div>
      {m.spark.length > 1 && (
        <div className="mt-3">
          <MiniSpark values={m.spark} width={296} height={40} stroke="rgb(var(--mp-accent))" />
          <div className="mt-1 text-[11px] text-mp-ink-3">Median sale price, last 24 months</div>
        </div>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-mp-line pt-3">
        {stat('median_sale_price', 'Median sale price', { format: 'currency' })}
        {stat('inventory', 'Active inventory', { format: 'count' })}
        {stat('median_dom', 'Days on market', { format: 'days' })}
        {stat('months_of_supply', 'Months of supply', { format: 'decimal1' })}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={metroPath(m.slug)} className="inline-flex h-10 items-center gap-2 rounded-control bg-mp-accent px-4 text-sm font-medium text-mp-accent-ink no-underline">
          Open dossier <ArrowRight size={15} strokeWidth={1.5} aria-hidden="true" />
        </Link>
        <Button onClick={() => onFly(m)}>Fly there</Button>
        <Button variant="quiet" onClick={() => onAround(m)} icon={<Crosshair size={15} strokeWidth={1.5} aria-hidden="true" />}>
          50 mi around
        </Button>
      </div>
    </section>
  );
}

// ---------- nothing selected ----------
export function IdlePanel({ headline, national }: { headline: string; national: string }) {
  return (
    <section aria-labelledby="idle-h">
      <div className="mp-label text-mp-accent">The atlas</div>
      <h2 id="idle-h" className="mp-display mt-2 text-[26px] leading-[1.08]">
        {headline}
      </h2>
      <p className="mt-2 text-sm text-mp-ink-2">{national}</p>
      <ul className="mt-4 space-y-2 border-t border-mp-line pt-3 text-[13px] text-mp-ink-2">
        <li className="flex gap-2">
          <MousePointerClick size={15} strokeWidth={1.5} className="mt-0.5 flex-none text-mp-accent" aria-hidden="true" />
          Click a column to select a metro; double-click to open its dossier.
        </li>
        <li className="flex gap-2">
          <Crosshair size={15} strokeWidth={1.5} className="mt-0.5 flex-none text-mp-accent" aria-hidden="true" />
          Click empty map to search the area around that point.
        </li>
        <li className="flex gap-2">
          <BarChart3 size={15} strokeWidth={1.5} className="mt-0.5 flex-none text-mp-accent" aria-hidden="true" />
          Shift-drag to lasso metros, then compare up to 3.
        </li>
      </ul>
    </section>
  );
}
