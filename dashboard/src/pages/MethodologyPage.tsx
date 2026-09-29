/**
 * Methodology (spec §7.6, M7) in the Night Atlas look: the principles, this run's
 * status, sources and attribution, map/terrain/type credits, the Sept 2026 source
 * change, how temperature, changes, payments and flags are computed, and what the
 * AI does (it narrates; the numbers come from code). `?section=<id>` deep-links.
 */
import { Calculator, Cpu, Database, Shapes, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { BRAND } from '../config/brand';
import { FLAG_RULES, TEMPERATURE_STEPS } from '../content/methodology';
import { useDataSource, useIndex, useManifest } from '../data/hooks';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useScrollToSection } from '../hooks/useSectionLink';
import { withAttribution } from '../lib/attribution';
import { formatDate, formatDateTime, formatMonth, formatUsd, MISSING } from '../lib/format';
import { flagName } from '../lib/metrics';
import { AtlasChrome } from '../ui/AtlasChrome';
import { Chip } from '../ui/controls';
import { GlassPanel } from '../ui/Glass';

const SECTIONS = [
  { id: 'principles', label: 'Principles' },
  { id: 'run', label: 'This data' },
  { id: 'sources', label: 'Sources' },
  { id: 'credits', label: 'Maps, 3D and type' },
  { id: 'methodology-changes', label: 'Sept 2026 change' },
  { id: 'temperature', label: 'Temperature' },
  { id: 'changes', label: 'Changes and units' },
  { id: 'flags', label: 'Flags' },
] as const;

export function MethodologyPage() {
  useDocumentTitle('Methodology');
  useScrollToSection();
  return (
    <AtlasChrome>
      <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-6 sm:px-8">
        <div className="mp-label">Methodology</div>
        <h1 className="mp-display mt-2 max-w-3xl text-[40px] leading-[1.02] sm:text-[60px]">Numbers come from code. The AI only narrates.</h1>
        <p className="mt-4 max-w-2xl text-mp-ink-2">How {BRAND.name} computes every number, where the data comes from, and what the AI does (and doesn’t) do.</p>
        <div className="mt-10 grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label="On this page" className="hidden lg:block">
            <ul className="sticky top-6 space-y-1.5 border-l border-mp-line pl-4 text-sm">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#/methodology?section=${s.id}`} onClick={(e) => (e.preventDefault(), document.getElementById(s.id)?.scrollIntoView({ block: 'start' }))} className="text-mp-ink-3 no-underline hover:text-mp-ink">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <Body />
        </div>
      </div>
    </AtlasChrome>
  );
}

function Body() {
  const index = useIndex();
  const manifest = useManifest();
  const source = useDataSource();
  const data = index.status === 'ready' ? index.data : null;
  const m = manifest.status === 'ready' ? manifest.data : null;
  const meta = data?.meta;
  const status = m?.status ?? meta?.status ?? null;
  const src = source.status === 'ready' ? source.data : null;

  return (
    <div className="min-w-0 space-y-14">
      <section id="principles" aria-label="Principles" className="grid scroll-mt-6 gap-4 md:grid-cols-3">
        <Principle icon={<Database size={16} strokeWidth={1.5} />} title="Public sources">
          Redfin, Zillow, FRED and the U.S. Census Bureau, refreshed weekly by a scheduled agent.
        </Principle>
        <Principle icon={<Cpu size={16} strokeWidth={1.5} />} title="Numbers from code">
          Every change, rank, score, flag and payment is computed deterministically in Python and unit-tested. The dashboard reformats them; it never invents one.
        </Principle>
        <Principle icon={<Sparkles size={16} strokeWidth={1.5} />} title="AI narrates only">
          Claude writes the analyst notes and investigations from computed facts; each figure it cites is checked against the data before publishing.
        </Principle>
      </section>

      <Section id="run" title="This data">
        {index.status === 'error' ? (
          <p className="text-mp-ink-2">The index didn’t load, so this run’s details aren’t available.</p>
        ) : !data ? (
          <p className="text-mp-ink-3" role="status">
            Loading…
          </p>
        ) : (
          <>
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              <Item label="Market data through" value={formatMonth(data.data_through, true)} />
              <Item label="Mortgage rates as of" value={formatDate(data.rates_as_of)} />
              <Item label="Last run" value={formatDateTime(m?.last_run_at ?? meta!.finished_at)} />
              <Item label="Run status" value={<Chip dot tone={status === 'ok' ? 'good' : status === 'stale' ? 'warn' : 'bad'}>{status ?? MISSING}</Chip>} />
              <Item label="Last data change" value={formatDateTime(m?.last_data_change_at)} />
              <Item label="Schedule" value={m?.next_run_hint ?? MISSING} />
              <Item label="Metros tracked" value={String(m?.items_count ?? data.metros.length)} />
              <Item label="AI cost of this run" value={formatUsd(m?.run_cost_usd ?? meta!.cost_usd)} />
              <Item
                label="Served from"
                value={src ? (src.source === 'sample' ? 'Committed sample snapshot (a real agent run)' : src.source === 'data-branch' ? `Live data branch (${src.detail ?? ''})` : 'Local agent output') : MISSING}
              />
            </dl>
            {meta!.warnings.length > 0 && (
              <div className="mt-6 border-t border-mp-line pt-4">
                <p className="mp-label mb-2">Notes from this run</p>
                <Bullets items={meta!.warnings} />
              </div>
            )}
          </>
        )}
      </Section>

      <Section id="sources" title="Sources and attribution">
        {data ? (
          <ul className="divide-y divide-mp-line">
            {withAttribution(data.sources).map((s) => (
              <li key={s.name} className="py-3 first:pt-0 last:pb-0">
                <a href={s.url} target="_blank" rel="noreferrer noopener" className="font-medium text-mp-accent">
                  {s.name}
                </a>
                {s.attribution && <p className="mt-0.5 text-sm text-mp-ink-3">{s.attribution}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-mp-ink-3">Sources load with the index.</p>
        )}
        <p className="mt-4 text-xs text-mp-ink-3">Raw datasets are not redistributed; the dashboard serves the agent’s computed outputs.</p>
      </Section>

      <Section id="credits" title="Maps, 3D and type">
        <ul className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
          <Credit title="Basemap">
            © <Ext href="https://openfreemap.org">OpenFreeMap</Ext>, © <Ext href="https://openmaptiles.org">OpenMapTiles</Ext>, data © <Ext href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</Ext>. Drawn with MapLibre GL and deck.gl.
          </Credit>
          <Credit title="Terrain">
            <Ext href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen Terrain Tiles</Ext> on AWS Open Data (USGS, SRTM, GMTED2010 and others), shown only when you turn terrain on.
          </Credit>
          <Credit title="Boundaries">
            U.S. states from <Ext href="https://github.com/topojson/us-atlas">us-atlas</Ext> (U.S. Census Bureau cartographic boundaries), for the 2D atlas.
          </Credit>
          <Credit title="Type">Instrument Serif, Inter Tight and Geist Mono, under the SIL Open Font License, self-hosted.</Credit>
        </ul>
        <div className="mt-6 flex gap-3 border-t border-mp-line pt-5 text-sm text-mp-ink-2">
          <Shapes size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-mp-ink-3" aria-hidden="true" />
          <p>
            <b className="font-medium text-mp-ink">Everything visual is procedural; there is no generated media.</b> The houses are built from boxes in three.js (sized by median price ÷ the U.S. median, lit by the market’s
            temperature); the region plates behind them are drawn from code, one per region rather than per city, and are marked illustrative. None of them is a photo of a real place.
          </p>
        </div>
      </Section>

      <Section id="methodology-changes" eyebrow="September 2026" title="Data sources and methodology changes">
        <p className="text-mp-ink-2">
          Redfin relaunched its Data Center in 2026 and stopped updating its older market-tracker exports after May 2026. Since September 2026, every Redfin series here comes from the{' '}
          <b className="font-medium text-mp-ink">relaunched Redfin Data Center files</b>, with monthly history back to 2012.
        </p>
        <div className="mt-3">
          <Bullets
            items={[
              'Each series comes from one source end to end: the new files are never spliced with the retired tracker, so every change and trend compares like with like.',
              'Some definitions and coverage changed, so some figures differ from earlier releases for the same month. For example, the national median sale price for May 2026 is $399,900 in the new files versus $449,846 in the old tracker. "Sold above list" now means above the original list price, and the price-drop share is the share of active listings with a price cut.',
              'Year-over-year and month-over-month changes are still computed here from the series; they match Redfin’s own published changes within rounding.',
            ]}
          />
        </div>
      </Section>

      <div className="grid gap-14 lg:grid-cols-2 lg:gap-8">
        <Section id="temperature" title="How market temperature works" subtitle="How competitive a metro is relative to the other tracked metros">
          <ol className="space-y-3 text-sm leading-relaxed text-mp-ink-2">
            {TEMPERATURE_STEPS.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="mp-num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mp-accent/15 text-[11px] text-mp-accent">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </Section>
        <Section id="changes" title="Changes and units">
          <ul className="space-y-2.5 text-sm leading-relaxed text-mp-ink-2">
            <li>YoY and MoM are percent changes for levels (prices, counts) and percentage-point (pp) differences for shares and ratios.</li>
            <li>Days-on-market changes are in days; months-of-supply changes are in months.</li>
            <li>Building permits use a rolling 12-month sum for YoY because monthly permits are noisy.</li>
            <li>Redfin’s median sale price isn’t seasonally adjusted, so compare year over year; MoM is context only.</li>
            <li className="flex gap-2">
              <Calculator size={16} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0 text-mp-ink-3" />
              Monthly payments are principal and interest on the median sale price with 20% down over 30 years at the latest 30-yr fixed rate. The affordability studio runs the same formula in your browser.
            </li>
          </ul>
        </Section>
      </div>

      <Section id="flags" title="How flags are computed" subtitle="Deterministic rules with configurable thresholds (defaults shown). Alerts group notable and major flags across metros.">
        <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Flag rules">
          <table className="w-full min-w-max border-collapse text-sm">
            <caption className="sr-only">Flag rules and severities</caption>
            <thead>
              <tr className="border-b border-mp-line text-left text-mp-ink-3">
                <th scope="col" className="py-2 pr-4 font-normal">
                  Flag
                </th>
                <th scope="col" className="py-2 pr-4 font-normal">
                  Rule
                </th>
                <th scope="col" className="py-2 font-normal">
                  Severity
                </th>
              </tr>
            </thead>
            <tbody>
              {FLAG_RULES.map((f) => (
                <tr key={f.id} className="border-b border-mp-line/60">
                  <th scope="row" className="py-2 pr-4 text-left font-medium text-mp-ink">
                    {flagName(f.id)}
                  </th>
                  <td className="py-2 pr-4 text-mp-ink-2">{f.rule}</td>
                  <td className="py-2 text-mp-ink-2">{f.severity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Section({ id, title, eyebrow, subtitle, children }: { id: string; title: string; eyebrow?: string; subtitle?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-6">
      {eyebrow && <div className="mp-label mb-1">{eyebrow}</div>}
      <h2 id={`${id}-h`} className="mp-display text-[30px] leading-tight sm:text-[36px]">
        {title}
      </h2>
      {subtitle && <p className="mt-1 text-sm text-mp-ink-3">{subtitle}</p>}
      <GlassPanel className="mt-4 p-5 sm:p-6">{children}</GlassPanel>
    </section>
  );
}

function Principle({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <GlassPanel className="p-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-mp-accent/15 text-mp-accent" aria-hidden="true">
        {icon}
      </span>
      <h2 className="mt-3 font-medium text-mp-ink">{title}</h2>
      <p className="mt-1 text-sm text-mp-ink-2">{children}</p>
    </GlassPanel>
  );
}

function Item({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-mp-ink-3">{label}</dt>
      <dd className="mp-num mt-1 text-mp-ink">{value}</dd>
    </div>
  );
}

function Credit({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <div className="mp-label">{title}</div>
      <p className="mt-1 text-mp-ink-2">{children}</p>
    </li>
  );
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-mp-accent">
      {children}
    </a>
  );
}

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="space-y-1.5 text-sm text-mp-ink-2">
      {items.map((w) => (
        <li key={w} className="flex gap-2">
          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-mp-ink-3" aria-hidden="true" />
          {w}
        </li>
      ))}
    </ul>
  );
}
