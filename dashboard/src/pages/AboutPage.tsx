import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { ErrorState, LoadingState } from '../components/ui/StateViews';
import { FLAG_RULES, TEMPERATURE_STEPS } from '../content/methodology';
import { useDataSource, useIndex, useManifest } from '../data/hooks';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { withAttribution } from '../lib/attribution';
import { formatDate, formatDateTime, formatMonth, formatUsd, MISSING } from '../lib/format';
import { flagName } from '../lib/metrics';

export function AboutPage() {
  useDocumentTitle('About and methodology');
  const index = useIndex();
  const manifest = useManifest();
  const source = useDataSource();
  const { hash } = useLocation();

  // /about#temperature: HashRouter owns the URL hash, so scroll to sections by id.
  useEffect(() => {
    const id = hash.replace(/^#/, '');
    if (id && index.status === 'ready') document.getElementById(id)?.scrollIntoView();
  }, [hash, index.status]);

  if (index.status === 'loading') return <LoadingState />;
  if (index.status === 'error') return <ErrorState error={index.error} onRetry={index.retry} />;
  const data = index.data;
  const m = manifest.status === 'ready' ? manifest.data : null;
  const meta = data.meta;

  return (
    <div className="space-y-6">
      <PageHeader title="About and methodology" subtitle="Where the numbers come from and how they're computed" />

      <Card id="run" title="This data">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Item label="Market data through" value={formatMonth(data.data_through, true)} />
          <Item label="Mortgage rates as of" value={formatDate(data.rates_as_of)} />
          <Item label="Last run" value={formatDateTime(m?.last_run_at ?? meta.finished_at)} />
          <Item label="Run status" value={<Badge tone={(m?.status ?? meta.status) === 'ok' ? 'positive' : 'warning'}>{m?.status ?? meta.status}</Badge>} />
          <Item label="Last data change" value={formatDateTime(m?.last_data_change_at)} />
          <Item label="Schedule" value={m?.next_run_hint ?? MISSING} />
          <Item label="Metros tracked" value={String(m?.items_count ?? data.metros.length)} />
          <Item label="AI cost of this run" value={formatUsd(m?.run_cost_usd ?? meta.cost_usd)} />
          <Item
            label="Data source"
            value={
              source.status === 'ready' && source.data
                ? source.data.source === 'sample'
                  ? 'Sample snapshot (a real agent run, committed with the dashboard)'
                  : source.data.source === 'data-branch'
                    ? `Live data branch (${source.data.detail ?? ''})`
                    : 'Local agent output'
                : MISSING
            }
          />
        </dl>
        {meta.warnings.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold">Warnings from this run</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm muted">
              {meta.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card id="ai" title="Numbers come from code; AI writes only the narrative">
        <div className="space-y-2 leading-relaxed">
          <p>
            Every figure on this site (changes, 36-month highs and lows, ranks, temperature scores, flags, the headline, key stats and the
            affordability numbers) is computed deterministically in Python from the source data and unit-tested.
          </p>
          <p>
            An AI model (Claude) writes the briefs and the "why this is happening" investigations from those computed facts only. Every number it
            writes is checked against the facts before publishing; if a check fails twice, a deterministic template is published instead
            (marked "Template narrative"). The calculator on each metro page runs in your browser with the same amortization formula.
          </p>
        </div>
      </Card>

      <Card id="sources" title="Sources and attribution">
        <ul className="space-y-3">
          {withAttribution(data.sources).map((s) => (
            <li key={s.name}>
              <a href={s.url} target="_blank" rel="noreferrer noopener" className="font-medium">
                {s.name}
              </a>
              {s.attribution && <p className="text-sm muted">{s.attribution}</p>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm muted">Map tiles © OpenStreetMap contributors. Raw datasets are not redistributed.</p>
      </Card>

      <Card id="temperature" title="How market temperature is computed">
        <p className="mb-2 text-sm muted">Temperature measures how competitive a metro is relative to the other tracked metros.</p>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
          {TEMPERATURE_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Card>

      <Card id="flags" title="How flags are computed">
        <p className="mb-3 text-sm muted">
          Flags are deterministic rules with configurable thresholds (defaults shown). The alerts strip shows notable and major flags grouped by rule.
        </p>
        <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Flag rules">
          <table className="table-base">
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
                  <th scope="row" className="font-normal">
                    {flagName(f.id)}
                  </th>
                  <td>{f.rule}</td>
                  <td>{f.severity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card id="changes" title="Changes and units">
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
          <li>YoY and MoM changes are percent changes for levels (prices, counts) and percentage-point (pp) differences for shares and ratios.</li>
          <li>Median days on market changes are differences in days; months of supply changes are differences in months.</li>
          <li>Building permits use a rolling 12-month sum for YoY, since monthly permits are noisy.</li>
          <li>Redfin data isn't seasonally adjusted, so compare year over year; MoM changes are shown for context.</li>
          <li>Monthly payments are principal and interest on the median sale price with 20% down, a 30-year term and the latest 30-year fixed rate.</li>
        </ul>
      </Card>
    </div>
  );
}

function Item({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
