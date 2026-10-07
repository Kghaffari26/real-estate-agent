/**
 * The listing-prep report (Listing Prep P5): ask for one, follow it, and see at once when
 * it was written in plain template wording, and why. The worker writes the report
 * (agents/listing_prep/report.py); its full view (the nine sections, evidence and
 * sharing) is P6. Every figure in a report is computed by the worker; this card formats
 * the request and the status only.
 */
import { FileText } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Report, ReportRequest } from '../../backend/intake';
import { formatDateTime } from '../../lib/format';
import { formatDollars } from '../../lib/intake';
import { Button } from '../../ui/controls';
import { Card } from '../DeskPage';

const input = 'h-11 w-full rounded-control border border-mp-line bg-mp-panel px-3 text-mp-ink';

const STATUS_TEXT: Record<Report['status'], string> = {
  queued: 'Queued. The worker picks up reports every 15 minutes; a report takes a few minutes.',
  running: 'Researching and writing the report…',
  done: 'Ready',
  failed: 'The report stopped before it finished',
  cancelled: 'The report was cancelled',
};
const ERROR_TEXT: Record<string, string> = {
  facts_unconfirmed: 'the facts were edited after it was requested; confirm them and ask again',
  cancelled_by_agent: 'someone on the team cancelled it',
  budget: 'it reached its spending limit',
  model_error: 'the AI service returned an error',
  worker_error: 'of an internal error',
};

/** Whole dollars or days from a form field; empty is "not set". */
function whole(v: FormDataEntryValue | null): number | null {
  const t = String(v ?? '').replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

export function ReportCard({
  report,
  factsConfirmed,
  onRequest,
  onCancel,
}: {
  report: Report | null;
  factsConfirmed: boolean;
  onRequest: (r: ReportRequest) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const active = report?.status === 'queued' || report?.status === 'running';
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = { target_price: whole(f.get('target_price')), budget: whole(f.get('budget')), days_to_list: whole(f.get('days_to_list')) };
    if (Object.values(r).some((v) => v !== null && (Number.isNaN(v) || v < 0))) {
      setProblem('Use whole numbers: dollars for the price and budget, days until listing.');
      return;
    }
    setProblem(null);
    await onRequest(r);
  };
  return (
    <Card title="Listing-prep report" icon={<FileText size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-report">
      <p className="text-sm text-mp-ink-2">
        What to change before listing and what it’s worth: an AI agent researches the confirmed facts, findings, market, buyer needs, your cost book and value priors, then writes the report. Every figure is computed, not written by the model, and the wording is checked for fair housing.
      </p>
      {report?.status === 'done' && report.note && (
        <p role="note" className="mt-3 rounded-control border border-mp-warn/40 px-3 py-2 text-sm text-mp-ink" data-testid="desk-report-notice">
          <b className="text-mp-warn">Plain wording.</b> {report.note.replace(/^Plain wording:\s*/, '')}
        </p>
      )}
      {report && (
        <p role="status" className="mt-3 text-sm text-mp-ink-2" data-testid="desk-report-status">
          Version {report.version}: {STATUS_TEXT[report.status]}
          {(report.status === 'failed' || report.status === 'cancelled') && report.error && <> because {ERROR_TEXT[report.error] ?? 'of an error'}</>}
          {report.status === 'done' && report.finished_at && <> {formatDateTime(report.finished_at)}</>}
          {report.status === 'done' && <>{report.narrative_source === 'template' ? ', in plain template wording' : ', with a written narrative'}. The full report view comes next.</>}
          {(report.status === 'failed' || report.status === 'cancelled') && '.'}
        </p>
      )}
      {report?.status === 'queued' && (
        <Button className="mt-2" onClick={() => onCancel(report.id)}>
          Cancel the request
        </Button>
      )}
      <form className="mt-4 grid gap-3 sm:grid-cols-3" onSubmit={submit} aria-label="Request a report">
        <label className="text-sm text-mp-ink-2">
          Target price ($, optional)
          <input name="target_price" inputMode="numeric" className={input} placeholder="1,450,000" />
        </label>
        <label className="text-sm text-mp-ink-2">
          Preparation budget ($, optional)
          <input name="budget" inputMode="numeric" className={input} placeholder="25,000" />
        </label>
        <label className="text-sm text-mp-ink-2">
          Days until listing (optional)
          <input name="days_to_list" inputMode="numeric" className={input} placeholder="30" />
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <Button type="submit" variant="primary" disabled={!factsConfirmed || active}>
            {report ? 'Request a new version' : 'Request a report'}
          </Button>
          {!factsConfirmed && <span className="text-xs text-mp-ink-3">Confirm the facts first.</span>}
          {active && <span className="text-xs text-mp-ink-3">One report at a time per property.</span>}
          {report?.target_price != null && <span className="text-xs text-mp-ink-3">Last asked: target {formatDollars(report.target_price)}{report.budget != null && <>, budget {formatDollars(report.budget)}</>}.</span>}
        </div>
        {problem && (
          <p role="alert" className="text-sm text-mp-bad sm:col-span-3">
            {problem}
          </p>
        )}
      </form>
    </Card>
  );
}
