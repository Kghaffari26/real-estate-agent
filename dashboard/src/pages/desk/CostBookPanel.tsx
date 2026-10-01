/**
 * The team's cost book (Listing Prep P1, spec §2): the contractor prices every
 * improvement estimate starts from. Managers import `docs/templates/cost_book.csv`
 * (filled in a spreadsheet) or edit rows here; agents read it. Per-property quotes
 * override it on the property's page.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { Download, Receipt, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { deskApi, DeskError, type Team } from '../../backend/desk';
import { intakeApi } from '../../backend/intake';
import { downloadBlob, slugifyFilename, toCsv } from '../../lib/csv';
import { COST_HEADER, COST_UNITS, formatDollars as money, parseCostBook, UNIT_LABELS, type CostRow, type CostUnit } from '../../lib/intake';
import { Button } from '../../ui/controls';
import { Card } from '../DeskPage';

const input = 'h-9 rounded-control border border-mp-line bg-mp-panel px-2 text-mp-ink';

export function CostBookPanel({ client, team, me }: { client: SupabaseClient; team: Team; me: string }) {
  const api = intakeApi(client);
  const [rows, setRows] = useState<CostRow[] | null>(null);
  const [manager, setManager] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [book, members] = await Promise.all([api.costBook(team.id), deskApi(client).members(team.id)]);
      setRows(book);
      setManager(members.some((m) => m.user_id === me && m.role === 'manager'));
    } catch (e) {
      setError(e instanceof DeskError ? e.message : 'Something went wrong. Try again.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, team.id, me]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      await load();
    } catch (e) {
      setError(e instanceof DeskError ? e.message : 'Something went wrong. Try again.');
    }
  };

  const importCsv = async (f: File) => {
    const parsed = parseCostBook(await f.text());
    setProblems(parsed.problems);
    await act(() => api.saveCostRows(team.id, parsed.rows), `Imported ${parsed.rows.length} item${parsed.rows.length === 1 ? '' : 's'}${parsed.problems.length ? `; ${parsed.problems.length} line${parsed.problems.length === 1 ? '' : 's'} skipped` : ''}.`);
  };

  const exportCsv = () =>
    downloadBlob(
      new Blob([toCsv(COST_HEADER, (rows ?? []).map((r) => [r.item, r.category, r.unit, r.low_usd, r.high_usd, r.notes]))], { type: 'text/csv' }),
      `${slugifyFilename(team.name)}-cost-book.csv`,
    );

  const priced = rows?.filter((r) => r.low_usd !== null).length ?? 0;
  return (
    <Card title={`${team.name} · cost book`} icon={<Receipt size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-cost-book">
      <p className="text-sm text-mp-ink-2">
        Your contractors’ prices, low to high per unit. Every improvement estimate starts here; a quote on a property overrides it there.
        {rows && rows.length > 0 && (
          <span className="text-mp-ink-3">
            {' '}
            {priced} of {rows.length} items priced.
          </span>
        )}
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
              aria-label="Cost book CSV file"
              data-testid="cost-book-file"
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
      {manager && <p className="mt-2 text-xs text-mp-ink-3">Start from docs/templates/cost_book.csv in the repo (the item list), fill low_usd and high_usd in a spreadsheet, and import it. Importing again replaces matching items.</p>}
      {notice && (
        <p role="status" className="mt-3 text-sm text-mp-good" data-testid="cost-book-notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-mp-bad">
          {error}
        </p>
      )}
      {problems.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-mp-warn" data-testid="cost-book-problems">
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
        <p className="mt-4 text-sm text-mp-ink-2">{manager ? 'The cost book is empty. Import the template to start.' : 'Your manager hasn’t set up the cost book yet.'}</p>
      ) : (
        <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Cost book items (scrolls sideways)">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Cost book items with low and high prices per unit</caption>
            <thead className="text-left text-[11px] uppercase tracking-[.06em] text-mp-ink-3">
              <tr>
                <th scope="col" className="py-2 font-medium">
                  Item
                </th>
                <th scope="col" className="py-2 font-medium">
                  Unit
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Low
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  High
                </th>
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) =>
                editing === r.item ? (
                  <EditRow key={r.item} row={r} onCancel={() => setEditing(null)} onSave={(next) => act(() => api.saveCostRows(team.id, [next]), `Saved ${next.item}.`).then(() => setEditing(null))} />
                ) : (
                  <tr key={r.item} className="border-t border-mp-line align-top">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      <span className="text-mp-ink">{r.item.replace(/_/g, ' ')}</span>
                      <span className="block text-xs text-mp-ink-3">
                        {r.category}
                        {r.notes ? ` · ${r.notes}` : ''}
                      </span>
                    </th>
                    <td className="py-2 pr-3 text-mp-ink-2">{UNIT_LABELS[r.unit]}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-mp-ink">{money(r.low_usd)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-mp-ink">{money(r.high_usd)}</td>
                    <td className="py-2 text-right">
                      {manager && (
                        <Button variant="quiet" onClick={() => setEditing(r.item)} aria-label={`Edit ${r.item.replace(/_/g, ' ')}`}>
                          Edit
                        </Button>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function EditRow({ row, onSave, onCancel }: { row: CostRow; onSave: (r: CostRow) => void; onCancel: () => void }) {
  const [unit, setUnit] = useState<CostUnit>(row.unit);
  const [low, setLow] = useState(row.low_usd === null ? '' : String(row.low_usd));
  const [high, setHigh] = useState(row.high_usd === null ? '' : String(row.high_usd));
  const [notes, setNotes] = useState(row.notes ?? '');
  const lo = low.trim() === '' ? null : Number(low.replace(/[$,]/g, ''));
  const hi = high.trim() === '' ? null : Number(high.replace(/[$,]/g, ''));
  const problem =
    (lo === null) !== (hi === null) ? 'Enter both prices, or neither.' : lo !== null && hi !== null && (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0) ? 'Prices are dollar amounts.' : lo !== null && hi !== null && hi < lo ? 'High is below low.' : null;
  const name = row.item.replace(/_/g, ' ');
  return (
    <tr className="border-t border-mp-line align-top" data-testid="cost-book-edit">
      <th scope="row" className="py-2 pr-3 text-left font-normal text-mp-ink">
        {name}
        <label className="mt-1 block text-xs text-mp-ink-3">
          Notes
          <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} className={`${input} mt-0.5 w-full`} />
        </label>
      </th>
      <td className="py-2 pr-3">
        <select aria-label={`Unit for ${name}`} value={unit} onChange={(e) => setUnit(e.target.value as CostUnit)} className={input}>
          {COST_UNITS.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABELS[u]}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-3 text-right">
        <input aria-label={`Low price for ${name}`} inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} className={`${input} w-24 text-right`} />
      </td>
      <td className="py-2 pr-3 text-right">
        <input aria-label={`High price for ${name}`} inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} className={`${input} w-24 text-right`} />
      </td>
      <td className="py-2 text-right">
        <span className="inline-flex gap-1">
          <Button variant="primary" disabled={Boolean(problem)} onClick={() => onSave({ ...row, unit, low_usd: lo, high_usd: hi, notes: notes.trim() || null })}>
            Save
          </Button>
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        </span>
        {problem && (
          <span role="alert" className="mt-1 block text-xs text-mp-bad">
            {problem}
          </span>
        )}
      </td>
    </tr>
  );
}
