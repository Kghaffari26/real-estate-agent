/**
 * The team's value priors (Listing Prep P4): for each improvement, the share of its cost
 * the team expects to recover at resale, low to high, with the source it relies on.
 * Managers import `docs/templates/value_priors.csv`; agents read. Nothing ships
 * pre-filled: industry cost-vs-value reports can't be embedded without a license, so an
 * item without a prior is reported as "not enough evidence" rather than guessed.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { Download, Scale, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { deskApi, DeskError, type Team } from '../../backend/desk';
import { intakeApi } from '../../backend/intake';
import { downloadBlob, slugifyFilename, toCsv } from '../../lib/csv';
import { parseValuePriors, PRIOR_HEADER, type ValuePrior } from '../../lib/intake';
import { Button } from '../../ui/controls';
import { Card } from '../DeskPage';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ValuePriorsPanel({ client, team, me }: { client: SupabaseClient; team: Team; me: string }) {
  const api = intakeApi(client);
  const [rows, setRows] = useState<ValuePrior[] | null>(null);
  const [manager, setManager] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [priors, members] = await Promise.all([api.valuePriors(team.id), deskApi(client).members(team.id)]);
      setRows(priors);
      setManager(members.some((m) => m.user_id === me && m.role === 'manager'));
    } catch (e) {
      setError(e instanceof DeskError ? e.message : 'Something went wrong. Try again.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, team.id, me]);
  useEffect(() => {
    load();
  }, [load]);

  const importCsv = async (f: File) => {
    setError(null);
    setNotice(null);
    const parsed = parseValuePriors(await f.text());
    setProblems(parsed.problems);
    try {
      await api.saveValuePriors(team.id, parsed.rows);
      const parts = [`Imported ${plural(parsed.rows.length, 'prior')}`];
      if (parsed.blank) parts.push(`${plural(parsed.blank, 'blank item')} left without one`);
      if (parsed.problems.length) parts.push(`${plural(parsed.problems.length, 'line')} skipped`);
      setNotice(`${parts.join('; ')}.`);
      await load();
    } catch (e) {
      setError(e instanceof DeskError ? e.message : 'Something went wrong. Try again.');
    }
  };

  const exportCsv = () =>
    downloadBlob(new Blob([toCsv(PRIOR_HEADER, (rows ?? []).map((r) => [r.item, r.recovery_low, r.recovery_high, r.source, r.notes]))], { type: 'text/csv' }), `${slugifyFilename(team.name)}-value-priors.csv`);

  return (
    <Card title={`${team.name} · value priors`} icon={<Scale size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-value-priors">
      <p className="text-sm text-mp-ink-2">
        How much of an improvement’s cost your team expects to get back at resale (120% means it adds more than it costs), with the source you rely on. Budget plans use the conservative end until comparable sales can measure it locally. An improvement without a prior is reported as “not enough evidence”.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {manager && (
          <>
            <Button icon={<Upload size={15} strokeWidth={1.5} aria-hidden="true" />} onClick={() => file.current?.click()}>
              Import CSV
            </Button>
            <input
              ref={file}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="Value priors CSV file"
              data-testid="value-priors-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) importCsv(f);
              }}
            />
          </>
        )}
        <Button variant="quiet" icon={<Download size={15} strokeWidth={1.5} aria-hidden="true" />} onClick={exportCsv} disabled={!rows?.length}>
          Export CSV
        </Button>
      </div>
      {manager && (
        <p className="mt-2 text-xs text-mp-ink-3">
          Start from docs/templates/value_priors.csv. Industry cost-vs-value reports are copyrighted and can’t be built into software without a license: use your team’s own experience, or figures you’re licensed to use, and name the source.
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-mp-good" data-testid="value-priors-notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-mp-bad">
          {error}
        </p>
      )}
      {problems.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-mp-warn" data-testid="value-priors-problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {rows === null ? (
        <p className="mt-4 text-sm text-mp-ink-3" role="status">
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-mp-ink-2">{manager ? 'No priors yet. Import the template once your team has filled it.' : 'No priors yet: your manager sets them.'}</p>
      ) : (
        <ul className="mt-4 divide-y divide-mp-line text-sm" data-testid="value-priors-list">
          {rows.map((r) => (
            <li key={r.item} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
              <span className="text-mp-ink">{r.item.replace(/_/g, ' ')}</span>
              <span className="tabular-nums text-mp-ink">
                {pct(r.recovery_low)}–{pct(r.recovery_high)} recovered
              </span>
              <span className="w-full text-xs text-mp-ink-3">Source: {r.source}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
