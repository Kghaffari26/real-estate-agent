import { Calculator, Cpu, Database, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { PageSkeleton } from '../components/ui/Skeleton';
import { ErrorState } from '../components/ui/StateViews';
import { StatusBadge } from '../components/ui/Status';
import { BRAND } from '../config/brand';
import { FLAG_RULES, TEMPERATURE_STEPS } from '../content/methodology';
import { useDataSource, useIndex, useManifest } from '../data/hooks';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { withAttribution } from '../lib/attribution';
import { formatDate, formatDateTime, formatMonth, formatUsd, MISSING } from '../lib/format';
import { flagName } from '../lib/metrics';

export function AboutPage() {
  useDocumentTitle('Methodology');
  const index = useIndex();
  const manifest = useManifest();
  const source = useDataSource();

  if (index.status === 'loading') return <PageSkeleton label="Loading…" />;
  if (index.status === 'error') return <ErrorState error={index.error} onRetry={index.retry} />;
  const data = index.data;
  const m = manifest.status === 'ready' ? manifest.data : null;
  const meta = data.meta;
  const status = m?.status ?? meta.status;
  const src = source.status === 'ready' ? source.data : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Methodology" subtitle={`How ${BRAND.name} computes every number, where the data comes from, and what the AI does (and doesn't) do.`} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Principle icon={<Database className="h-4 w-4" />} title="Public sources">
          Redfin, Zillow, FRED and the U.S. Census Bureau, refreshed weekly by a scheduled agent.
        </Principle>
        <Principle icon={<Cpu className="h-4 w-4" />} title="Numbers from code">
          Every change, rank, score, flag and payment is computed deterministically in Python and unit-tested.
        </Principle>
        <Principle icon={<Sparkles className="h-4 w-4" />} title="AI writes narrative only">
          Claude writes the analyst notes and investigations from computed facts; each figure it cites is checked before publishing.
        </Principle>
      </div>

      <Card id="run" title="This data" copyLink>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Item label="Market data through" value={formatMonth(data.data_through, true)} />
          <Item label="Mortgage rates as of" value={formatDate(data.rates_as_of)} />
          <Item label="Last run" value={formatDateTime(m?.last_run_at ?? meta.finished_at)} />
          <Item label="Run status" value={<StatusBadge status={status === 'ok' ? 'good' : status === 'stale' ? 'warning' : 'bad'}>{status}</StatusBadge>} />
          <Item label="Last data change" value={formatDateTime(m?.last_data_change_at)} />
          <Item label="Schedule" value={m?.next_run_hint ?? MISSING} />
          <Item label="Metros tracked" value={String(m?.items_count ?? data.metros.length)} />
          <Item label="AI cost of this run" value={formatUsd(m?.run_cost_usd ?? meta.cost_usd)} />
          <Item
            label="Served from"
            value={src ? (src.source === 'sample' ? 'Committed sample snapshot (a real agent run)' : src.source === 'data-branch' ? `Live data branch (${src.detail ?? ''})` : 'Local agent output') : MISSING}
          />
        </dl>
        {meta.warnings.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <p className="eyebrow mb-2">Notes from this run</p>
            <ul className="space-y-1.5 text-sm text-text-2">
              {meta.warnings.map((w) => (
                <li key={w} className="flex gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-3" aria-hidden="true" />
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card id="sources" title="Sources and attribution" copyLink>
        <ul className="divide-y divide-border">
          {withAttribution(data.sources).map((s) => (
            <li key={s.name} className="py-3 first:pt-0 last:pb-0">
              <a href={s.url} target="_blank" rel="noreferrer noopener" className="font-medium">
                {s.name}
              </a>
              {s.attribution && <p className="mt-0.5 text-sm text-text-3">{s.attribution}</p>}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-text-3">Basemap © OpenFreeMap, © OpenMapTiles, data © OpenStreetMap contributors. Raw datasets are not redistributed.</p>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card id="temperature" title="How market temperature works" subtitle="How competitive a metro is relative to the other tracked metros" copyLink>
          <ol className="space-y-3 text-sm leading-relaxed text-text-2">
            {TEMPERATURE_STEPS.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </Card>
        <Card id="changes" title="Changes and units" copyLink>
          <ul className="space-y-2.5 text-sm leading-relaxed text-text-2">
            <li>YoY and MoM are percent changes for levels (prices, counts) and percentage-point (pp) differences for shares and ratios.</li>
            <li>Days-on-market changes are in days; months-of-supply changes are in months.</li>
            <li>Building permits use a rolling 12-month sum for YoY because monthly permits are noisy.</li>
            <li>Redfin's median sale price isn't seasonally adjusted, so compare year over year; MoM is context only.</li>
            <li className="flex gap-2">
              <Calculator aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-text-3" />
              Monthly payments are principal and interest on the median sale price with 20% down over 30 years at the latest 30-yr fixed rate. The calculator runs the same formula in your browser.
            </li>
          </ul>
        </Card>
      </div>

      <Card id="flags" title="How flags are computed" subtitle="Deterministic rules with configurable thresholds (defaults shown). Alerts group notable and major flags across metros." copyLink>
        <div className="relative max-w-full overflow-x-auto rounded-md border border-border" tabIndex={0} role="region" aria-label="Flag rules">
          <table className="table-base min-w-max">
            <caption className="sr-only">Flag rules and severities</caption>
            <thead>
              <tr>
                <th scope="col">Flag</th>
                <th scope="col">Rule</th>
                <th scope="col">Severity</th>
              </tr>
            </thead>
            <tbody>
              {FLAG_RULES.map((f) => (
                <tr key={f.id}>
                  <th scope="row" className="border-b border-border px-3 py-2 text-left font-medium">
                    {flagName(f.id)}
                  </th>
                  <td className="text-text-2">{f.rule}</td>
                  <td className="text-text-2">{f.severity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Principle({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="card p-4">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent" aria-hidden="true">
        {icon}
      </span>
      <h2 className="mt-3 text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-text-3">{children}</p>
    </div>
  );
}

function Item({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-text-3">{label}</dt>
      <dd className="num mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
