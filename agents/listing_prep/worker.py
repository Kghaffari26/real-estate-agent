"""The Listing Prep worker: photo findings (P2), reports (P5) and photo housekeeping.

    python -m agents.listing_prep.worker            # janitor, property insights, queued vision jobs, then queued reports
    python -m agents.listing_prep.worker --janitor  # housekeeping only

Run by `.github/workflows/listing-prep-worker.yml` (on a schedule and on demand). Needs
SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the worker's secrets, never the site's);
without them it exits quietly. Without an Anthropic key the janitor still runs and jobs
stay queued.

Per job, per photo, in order:
  1. the property must still have a processing consent (checked before every photo; the
     database also refuses findings and results without one, so a revocation mid-photo
     can't slip through);
  2. the stored file is decoded here: one that still carries EXIF/GPS data is rejected
     and deleted, one that can't be read is skipped (photo_check.py);
  3. the model sees only re-encoded pixels and answers through a tool (findings.py);
  4. people visible → skipped; findings screened for fair housing; then stored.

Reports (`report.py`): per claimed report, the worker reads the property's confirmed facts,
insights, confirmed findings, the team's cost book and value priors and the quotes (no
names, no street address), runs the report agent, and stores the assembled report. A
report is claimed only while the run's spend cap leaves room for a whole one.

The janitor applies retention (`expire_photos`), queues orphaned files, and deletes every
queued file through the Storage API (a photo or property deleted on the Desk queues its
files in the database).

Logs carry counts and ids only (the repository is public).
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from agents_core.costs import BudgetExceeded
from agents_core.llm import LLMError

from agents.listing_prep import findings as vision
from agents.listing_prep import report as reports
from agents.listing_prep.backend import Backend, ConsentRevoked, Job, ReportJob, SupabaseBackend
from agents.listing_prep.insights import REGION_DATA_URL, insights_pass
from agents.listing_prep.photo_check import for_model, inspect

log = logging.getLogger("listing_prep.worker")

MAX_JOBS_PER_RUN = 10
MAX_REPORTS_PER_RUN = 2  # each up to ~7 minutes and reports.BUDGET
DELETIONS_PER_RUN = 1000
# agents-core estimates a request's cost from its JSON size, so a base64 photo is costed
# as ~80K input tokens (≈ $0.09 on the fast tier) though it bills ~1.6K. Each photo's
# scope must clear that estimate; actual spend is about $0.004 a photo.
PHOTO_BUDGET_USD = 0.12
JOB_BUDGET_PER_PHOTO_USD = 0.02

NOTE_METADATA = "This photo still had location or camera data, so it wasn’t analyzed and was deleted. Upload it again from the Desk, which removes that data."
NOTE_UNREADABLE = "This file couldn’t be read as a JPEG or WebP photo. Upload it again."
NOTE_MISSING = "The photo’s file is missing. Upload it again."


@dataclass
class JobReport:
    status: str
    photos: int = 0
    analyzed: int = 0
    skipped: int = 0
    rejected: int = 0
    findings: int = 0
    dropped_fair_housing: int = 0
    usd: float = 0.0


def _now() -> str:
    return datetime.now(UTC).isoformat()


def process_job(backend: Backend, llm: Any, job: Job, *, scope_factory: Any = None) -> JobReport:
    """Run one claimed job to an end state (done / cancelled / failed)."""
    if not backend.processing_consent(job.property_id):
        backend.update_job(job.id, status="cancelled", error="consent_revoked", finished_at=_now())
        return JobReport("cancelled")
    photos = backend.pending_photos(job.property_id)
    cost_items = backend.team_cost_items(job.property_id)
    report = JobReport("done", photos=len(photos))
    backend.update_job(job.id, photos_total=len(photos), prompt_version=vision.PROMPT_VERSION)
    job_scope = scope_factory(JOB_BUDGET_PER_PHOTO_USD * len(photos) + PHOTO_BUDGET_USD, "job") if scope_factory else None
    try:
        for i, photo in enumerate(photos, 1):
            if not backend.processing_consent(job.property_id):
                raise ConsentRevoked()
            data = backend.download(photo.storage_path)
            check = inspect(data) if data is not None else None
            if check is None or not check.ok:
                if check is not None and check.reason == "metadata":
                    backend.delete_objects([photo.storage_path])
                    backend.record_result(photo.id, job.id, "rejected_metadata", NOTE_METADATA, vision.PROMPT_VERSION)
                    report.rejected += 1
                else:
                    backend.record_result(photo.id, job.id, "skipped_unusable", NOTE_MISSING if data is None else NOTE_UNREADABLE, vision.PROMPT_VERSION)
                    report.skipped += 1
            else:
                out = vision.analyze_photo(llm, for_model(data), photo.room, cost_items, budget=job_scope)
                report.usd += out.usd
                rows = [
                    {
                        "property_id": job.property_id,
                        "photo_id": photo.id,
                        "job_id": job.id,
                        "room": photo.room,
                        "category": f.category,
                        "condition": f.condition,
                        "issue": f.issue,
                        "suggested_fix": f.suggested_fix,
                        "fix_item": f.fix_item,
                        "quantity": f.quantity,
                        "severity": f.severity,
                        "evidence": f.evidence.model_dump(),
                        "model_confidence": f.confidence,
                        "prompt_version": vision.PROMPT_VERSION,
                    }
                    for f in out.findings
                ]
                backend.insert_findings(rows)
                backend.record_result(photo.id, job.id, out.outcome, out.note, vision.PROMPT_VERSION)
                report.findings += len(rows)
                report.dropped_fair_housing += out.dropped_fair_housing
                if out.outcome == "analyzed":
                    report.analyzed += 1
                else:
                    report.skipped += 1
            backend.update_job(job.id, photos_done=i, usd=round(report.usd, 4))
    except ConsentRevoked:
        # The revocation trigger has already cancelled the job and withdrawn its findings;
        # this only covers a revocation the trigger couldn't see (none today).
        backend.update_job(job.id, status="cancelled", error="consent_revoked", finished_at=_now())
        report.status = "cancelled"
        return report
    except Exception as e:  # noqa: BLE001 - any failure ends the job, never the run
        error = _error_code(e)
        log.warning("job %s failed: %s", job.id, type(e).__name__)
        backend.update_job(job.id, status="failed", error=error, finished_at=_now(), usd=round(report.usd, 4))
        report.status = "failed"
        return report
    backend.update_job(job.id, status="done", finished_at=_now(), usd=round(report.usd, 4))
    return report


def _error_code(e: Exception) -> str:
    if isinstance(e, BudgetExceeded):
        return "budget"
    if isinstance(e, LLMError) or type(e).__module__.split(".")[0] == "anthropic":
        return "model_error"
    return "worker_error"


def process_report(backend: Backend, llm: Any, job: ReportJob, region: dict[str, Any] | None) -> dict[str, Any]:
    """Run one claimed report to an end state (done / cancelled / failed)."""
    inputs = backend.report_inputs(job.property_id)
    if inputs is None or not inputs["property"].get("facts_confirmed_at"):
        # The facts were edited (un-confirming them) after the report was asked for.
        backend.update_report(job.id, status="cancelled", error="facts_unconfirmed", finished_at=_now())
        return {"id": job.id, "status": "cancelled", "usd": 0.0}
    goal = reports.Goal(target_price=job.target_price, budget=int(job.budget) if job.budget is not None else None, days_to_list=job.days_to_list)
    try:
        out = reports.run_report(llm, reports.build_world(inputs, region, goal))
    except Exception as e:  # noqa: BLE001 - a failure ends the report, never the run
        log.warning("report %s failed: %s", job.id, type(e).__name__)
        backend.update_report(job.id, status="failed", error=_error_code(e), finished_at=_now())
        return {"id": job.id, "status": "failed", "usd": 0.0}
    backend.update_report(
        job.id,
        status="done",
        output=out,
        narrative_source=out["narrative_source"],
        prompt_version=out["prompt_version"],
        usd=round(out["cost_usd"], 4),
        finished_at=_now(),
    )
    return {"id": job.id, "status": "done", "narrative_source": out["narrative_source"], "usd": out["cost_usd"]}


def room_for_a_report(llm: Any) -> bool:
    """True while the run's cap can still pay for a whole report (loop and review)."""
    tracker = getattr(llm, "tracker", None)
    if tracker is None:
        return True
    return tracker.total_usd + reports.BUDGET.max_usd + reports.REVIEW_BUDGET_USD <= tracker.max_usd


def janitor(backend: Backend) -> dict[str, int]:
    expired = backend.expire_photos()
    orphans = backend.queue_orphans()
    deleted = 0
    while deleted < DELETIONS_PER_RUN:
        batch = backend.deletions(100)
        if not batch:
            break
        backend.delete_objects([p for _, p in batch])
        backend.clear_deletions([i for i, _ in batch])
        deleted += len(batch)
    return {"expired": expired, "orphans": orphans, "files_deleted": deleted}


def run(backend: Backend, llm: Any | None, *, janitor_only: bool = False, scope_factory: Any = None, http: Any = None) -> dict[str, Any]:
    summary: dict[str, Any] = {"janitor": janitor(backend), "jobs": [], "insights": 0, "reports": []}
    if janitor_only:
        return summary
    if http is not None:
        # Value ranges, demand, schools and amenities: no model calls (P3).
        summary["insights"] = insights_pass(backend, http)
    if llm is None:
        return summary
    for _ in range(MAX_JOBS_PER_RUN):
        job = backend.claim_job()
        if job is None:
            break
        r = process_job(backend, llm, job, scope_factory=scope_factory)
        summary["jobs"].append({"id": job.id, **vars(r)})
    region: dict[str, Any] | None = None
    for i in range(MAX_REPORTS_PER_RUN):
        if not room_for_a_report(llm):
            break
        rjob = backend.claim_report_job()
        if rjob is None:
            break
        if i == 0 and http is not None:
            try:
                region = http.get_json(REGION_DATA_URL, ttl_seconds=3600)
            except Exception:  # noqa: BLE001 - the report says the market data is missing
                region = None
        summary["reports"].append(process_report(backend, llm, rjob, region))
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--janitor", action="store_true", help="housekeeping only (no model calls)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not (url and key):
        print("listing-prep worker: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set; nothing to do.")
        return 0

    from agents_core import settings
    from agents_core.costs import CostTracker, SpendScope
    from agents_core.http import Http
    from agents_core.llm import LLM

    http = Http()
    backend = SupabaseBackend(http, url, key)
    llm = None
    scope_factory = None
    try:
        has_key = bool(settings.anthropic_api_key())
    except RuntimeError:
        has_key = False
    if has_key:
        tracker = CostTracker(agent="listing_prep", run_id=uuid.uuid4().hex[:12], path=settings.data_dir() / "listing_prep_costs.jsonl")
        llm = LLM(tracker)
        scope_factory = lambda usd, label: SpendScope(tracker, usd, label=label)  # noqa: E731
    elif not args.janitor:
        print("listing-prep worker: no Anthropic key; housekeeping only, jobs stay queued.")
    summary = run(backend, llm, janitor_only=args.janitor, scope_factory=scope_factory, http=http)
    jobs = summary["jobs"]
    print(
        "listing-prep worker:",
        summary["janitor"],
        f"insights={summary['insights']}",
        f"jobs={len(jobs)}",
        {k: sum(j[k] for j in jobs) for k in ("analyzed", "skipped", "rejected", "findings", "dropped_fair_housing")} if jobs else {},
        f"usd={sum(j['usd'] for j in jobs):.4f}",
        f"reports={len(summary['reports'])}",
        {s: sum(1 for r in summary["reports"] if r["status"] == s) for s in ("done", "failed", "cancelled")} if summary["reports"] else {},
        f"report_usd={sum(r['usd'] for r in summary['reports']):.4f}",
    )
    return 1 if any(j["status"] == "failed" for j in jobs) or any(r["status"] == "failed" for r in summary["reports"]) else 0


if __name__ == "__main__":
    sys.exit(main())
