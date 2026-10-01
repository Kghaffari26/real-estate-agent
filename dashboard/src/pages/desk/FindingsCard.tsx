/**
 * Photo findings (Listing Prep P2): request an analysis, follow it, and review what the
 * model saw: confirm, edit or reject each finding. Nothing is used downstream until an
 * agent has confirmed or edited it. Findings withdrawn by a consent revocation show
 * only as a count; their text is no longer shown. The worker and the database enforce
 * the rules; this card states them and reflects the outcome.
 */
import { ScanSearch } from 'lucide-react';
import { useState } from 'react';
import type { Finding, FindingEdit, Photo, PhotoResult, VisionJob } from '../../backend/intake';
import { formatDateTime } from '../../lib/format';
import { CATEGORY_LABELS, CONDITION_LABELS, findingCounts, roomLabel, SEVERITY_LABELS, type Readiness } from '../../lib/intake';
import { Button } from '../../ui/controls';
import { Card } from '../DeskPage';

const input = 'rounded-control border border-mp-line bg-mp-panel px-2 text-mp-ink';

const JOB_TEXT: Record<VisionJob['status'], string> = {
  queued: 'Queued. The worker picks up analyses every 15 minutes.',
  running: 'Analyzing',
  done: 'Analyzed',
  failed: 'The analysis stopped before it finished',
  cancelled: 'The analysis was cancelled',
};
const ERROR_TEXT: Record<string, string> = {
  consent_revoked: 'the seller’s consent was revoked',
  budget: 'it reached its spending limit',
  model_error: 'the AI service returned an error',
  worker_error: 'of an internal error',
};

export function FindingsCard({
  readiness,
  job,
  findings,
  photos,
  results,
  onRequest,
  onReview,
}: {
  readiness: Readiness;
  job: VisionJob | null;
  findings: Finding[];
  photos: Photo[];
  results: PhotoResult[];
  onRequest: () => Promise<void>;
  onReview: (id: string, edit: FindingEdit) => Promise<void>;
}) {
  const counts = findingCounts(findings);
  const visible = findings.filter((f) => f.status !== 'withdrawn');
  const photoById = new Map(photos.map((p) => [p.id, p]));
  const skipped = results.filter((r) => r.outcome !== 'analyzed' || r.note);
  const active = job && (job.status === 'queued' || job.status === 'running');
  return (
    <Card title="Condition findings" icon={<ScanSearch size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-findings">
      <p className="text-sm text-mp-ink-2">
        An AI model reads each photo for the property’s condition and the fixes that would help it sell, and nothing else: photos with people in them are skipped, and findings about occupants, belongings or the neighborhood are left out. You confirm, edit or reject every finding before it’s used.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!readiness.ok} onClick={onRequest}>
          Analyze photos
        </Button>
        {!readiness.ok && (
          <span className="text-xs text-mp-ink-3" data-testid="desk-findings-blocked">
            {readiness.reason}
          </span>
        )}
      </div>
      {job && (
        <p role="status" className="mt-3 text-sm text-mp-ink-2" data-testid="desk-job">
          {job.status === 'running' && job.photos_total ? `${JOB_TEXT.running}: ${job.photos_done} of ${job.photos_total} photos…` : JOB_TEXT[job.status]}
          {(job.status === 'failed' || job.status === 'cancelled') && job.error && <> because {ERROR_TEXT[job.error] ?? 'of an error'}</>}
          {job.status === 'done' && job.finished_at && <> {formatDateTime(job.finished_at)}</>}
          {!active && (job.status === 'failed' || job.status === 'cancelled') ? '.' : job.status === 'done' ? '.' : ''}
        </p>
      )}
      {counts.withdrawn > 0 && (
        <p className="mt-3 text-sm text-mp-warn" data-testid="desk-findings-withdrawn">
          {counts.withdrawn} finding{counts.withdrawn === 1 ? ' was' : 's were'} withdrawn when the seller revoked consent. {counts.withdrawn === 1 ? 'It isn’t' : 'They aren’t'} shown or used.
        </p>
      )}
      {skipped.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" data-testid="desk-photo-notes">
          {skipped.map((r) => {
            const p = photoById.get(r.photo_id);
            return (
              <li key={r.photo_id} className="text-mp-ink-2">
                <span className="text-mp-ink">{p ? roomLabel(p.room) : 'A photo'}:</span> {r.note}
              </li>
            );
          })}
        </ul>
      )}
      {visible.length > 0 && (
        <>
          <p className="mt-4 text-xs text-mp-ink-3" data-testid="desk-findings-counts">
            {visible.length} finding{visible.length === 1 ? '' : 's'}: {counts.proposed} to review, {counts.confirmed + counts.edited} confirmed, {counts.rejected} rejected.
          </p>
          <ul className="mt-2 space-y-3">
            {visible.map((f) => (
              <FindingRow key={f.id} finding={f} photo={f.photo_id ? (photoById.get(f.photo_id) ?? null) : null} onReview={(edit) => onReview(f.id, edit)} />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function FindingRow({ finding: f, photo, onReview }: { finding: Finding; photo: Photo | null; onReview: (edit: FindingEdit) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [issue, setIssue] = useState(f.issue);
  const [fix, setFix] = useState(f.suggested_fix ?? '');
  const [condition, setCondition] = useState(f.condition);
  const label = `${roomLabel(f.room)}: ${CATEGORY_LABELS[f.category] ?? f.category}`;
  const reviewed = f.status === 'confirmed' || f.status === 'edited' || f.status === 'rejected';
  return (
    <li className={`flex gap-3 rounded-control border border-mp-line p-3 ${f.status === 'rejected' ? 'border-dashed' : ''}`} data-testid="desk-finding" data-status={f.status}>
      {photo?.url && f.evidence && (
        <div className="relative h-20 w-28 flex-none overflow-hidden rounded-control bg-mp-panel" aria-hidden="true">
          <img src={photo.url} alt="" className="h-full w-full object-cover" />
          <div
            className="absolute border-2 border-mp-accent"
            style={{ left: `${f.evidence.x * 100}%`, top: `${f.evidence.y * 100}%`, width: `${f.evidence.w * 100}%`, height: `${f.evidence.h * 100}%` }}
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-[.06em] text-mp-ink-3">
          {label} · {SEVERITY_LABELS[f.severity]} · condition {f.condition}/5 ({CONDITION_LABELS[f.condition]?.toLowerCase()})
          {f.model_confidence && <> · {f.model_confidence} confidence</>}
        </div>
        {editing ? (
          <div className="mt-2 grid gap-2">
            <label className="flex flex-col gap-1 text-xs text-mp-ink-2">
              What’s wrong
              <textarea value={issue} maxLength={300} onChange={(e) => setIssue(e.target.value)} className={`${input} min-h-[56px] py-1 text-sm`} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-mp-ink-2">
              Suggested fix
              <textarea value={fix} maxLength={300} onChange={(e) => setFix(e.target.value)} className={`${input} min-h-[56px] py-1 text-sm`} />
            </label>
            <label className="flex items-center gap-2 text-xs text-mp-ink-2">
              Condition
              <select value={condition} onChange={(e) => setCondition(Number(e.target.value))} className={`${input} h-8 text-sm`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}: {CONDITION_LABELS[n]}
                  </option>
                ))}
              </select>
            </label>
            <span className="flex gap-2">
              <Button
                variant="primary"
                disabled={issue.trim().length < 3}
                onClick={() => onReview({ status: 'edited', issue: issue.trim(), suggested_fix: fix.trim() || null, condition }).then(() => setEditing(false))}
              >
                Save and confirm
              </Button>
              <Button variant="quiet" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </span>
          </div>
        ) : (
          <>
            <p className={`mt-1 text-sm text-mp-ink ${f.status === 'rejected' ? 'line-through' : ''}`}>{f.issue}</p>
            {f.suggested_fix && <p className="text-sm text-mp-ink-2">Fix: {f.suggested_fix}</p>}
            {f.fix_item && (
              <p className="text-xs text-mp-ink-3">
                Cost book: {f.fix_item.replace(/_/g, ' ')}
                {f.quantity !== null && <> × {f.quantity}</>}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {reviewed && <span className={`text-xs ${f.status === 'rejected' ? 'text-mp-ink-3' : 'text-mp-good'}`}>{f.status === 'rejected' ? 'Rejected' : f.status === 'edited' ? 'Edited and confirmed' : 'Confirmed'}</span>}
              {f.status !== 'confirmed' && f.status !== 'edited' && (
                <Button variant="quiet" onClick={() => onReview({ status: 'confirmed' })} aria-label={`Confirm: ${f.issue}`}>
                  Confirm
                </Button>
              )}
              <Button variant="quiet" onClick={() => setEditing(true)} aria-label={`Edit: ${f.issue}`}>
                Edit
              </Button>
              {f.status !== 'rejected' && (
                <Button variant="quiet" onClick={() => onReview({ status: 'rejected' })} aria-label={`Reject: ${f.issue}`}>
                  Reject
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </li>
  );
}
