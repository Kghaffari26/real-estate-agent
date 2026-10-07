"""The worker's view of the Desk's backend, and its Supabase implementation.

The worker uses the service role (SUPABASE_SERVICE_ROLE_KEY, a server-side secret of
the worker's workflow only; the site never has it). Row-level security doesn't apply to
it, so every consent and scope rule the worker relies on is checked explicitly here or
enforced by the database's triggers (findings can't be inserted without a processing
consent, whoever inserts them).

All HTTP goes through `agents_core.http.Http`, uncached (`ttl_seconds=0`). Nothing is
logged beyond counts and ids: the worker's logs are public on a public repository.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from urllib.parse import quote

from agents_core.http import Http, HttpError

BUCKET = "property-photos"


@dataclass(frozen=True)
class Job:
    id: str
    property_id: str


@dataclass(frozen=True)
class PhotoRow:
    id: str
    room: str
    storage_path: str


@dataclass(frozen=True)
class ReportJob:
    id: str
    property_id: str
    target_price: int | None = None
    budget: float | None = None
    days_to_list: int | None = None


class ConsentRevoked(RuntimeError):
    """The database refused a write because the property no longer has a processing consent."""


class Backend(Protocol):
    def claim_job(self) -> Job | None: ...
    def processing_consent(self, property_id: str) -> bool: ...
    def pending_photos(self, property_id: str) -> list[PhotoRow]: ...
    def team_cost_items(self, property_id: str) -> dict[str, str]: ...
    def download(self, path: str) -> bytes | None: ...
    def delete_objects(self, paths: list[str]) -> None: ...
    def record_result(self, photo_id: str, job_id: str, outcome: str, note: str | None, prompt_version: str) -> None: ...
    def insert_findings(self, rows: list[dict[str, Any]]) -> None: ...
    def update_job(self, job_id: str, **fields: Any) -> None: ...
    def expire_photos(self) -> int: ...
    def queue_orphans(self) -> int: ...
    def deletions(self, limit: int) -> list[tuple[int, str]]: ...
    def clear_deletions(self, ids: list[int]) -> None: ...
    def needing_insights(self, limit: int) -> list[dict[str, Any]]: ...
    def reviewed_findings(self, property_id: str) -> list[tuple[int, str]]: ...
    def upsert_insights(self, row: dict[str, Any]) -> None: ...
    def claim_report_job(self) -> ReportJob | None: ...
    def report_inputs(self, property_id: str) -> dict[str, Any] | None: ...
    def update_report(self, report_id: str, **fields: Any) -> None: ...


class SupabaseBackend:
    def __init__(self, http: Http, url: str, service_key: str) -> None:
        self.http = http
        self.url = url.rstrip("/")
        self._headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    # ---- plumbing ----

    def _rest(self, method: str, path: str, *, params: dict[str, Any] | None = None, body: Any = None, prefer: str | None = None) -> Any:
        headers = dict(self._headers)
        if prefer:
            headers["Prefer"] = prefer
        try:
            res = self.http.request(method, f"{self.url}/rest/v1/{path}", params=params, headers=headers, json_body=body, ttl_seconds=0)
        except HttpError as e:
            # The service role bypasses row-level security, so a 403 (PostgREST's code for
            # 42501) on a write can only come from the triggers that refuse findings and
            # results without a processing consent: it was revoked mid-job.
            if e.status == 403 and method != "GET":
                raise ConsentRevoked() from e
            raise
        return res.json() if res.content else None

    def _rpc(self, name: str, args: dict[str, Any] | None = None) -> Any:
        return self._rest("POST", f"rpc/{name}", body=args or {})

    # ---- jobs ----

    def claim_job(self) -> Job | None:
        rows = self._rpc("claim_vision_job") or []
        return Job(rows[0]["id"], rows[0]["property_id"]) if rows else None

    def processing_consent(self, property_id: str) -> bool:
        return bool(self._rpc("processing_consent", {"property": property_id}))

    def pending_photos(self, property_id: str) -> list[PhotoRow]:
        """The property's photos without a result yet (a revocation clears results)."""
        rows = self._rest("GET", "photos", params={"select": "id,room,storage_path,photo_results(photo_id)", "property_id": f"eq.{property_id}", "order": "created_at"})
        return [PhotoRow(r["id"], r["room"], r["storage_path"]) for r in rows if not r.get("photo_results")]

    def team_cost_items(self, property_id: str) -> dict[str, str]:
        prop = self._rest("GET", "properties", params={"select": "team_id", "id": f"eq.{property_id}"})
        if not prop:
            return {}
        rows = self._rest("GET", "cost_book", params={"select": "item,unit", "team_id": f"eq.{prop[0]['team_id']}"})
        return {r["item"]: r["unit"] for r in rows}

    def update_job(self, job_id: str, **fields: Any) -> None:
        self._rest("PATCH", "vision_jobs", params={"id": f"eq.{job_id}"}, body=fields)

    # ---- photos and results ----

    def download(self, path: str) -> bytes | None:
        try:
            res = self.http.request("GET", f"{self.url}/storage/v1/object/authenticated/{BUCKET}/{quote(path)}", headers=self._headers, ttl_seconds=0)
        except HttpError as e:
            if getattr(e, "status", None) in (400, 404):
                return None
            raise
        return res.content

    def delete_objects(self, paths: list[str]) -> None:
        for i in range(0, len(paths), 100):
            self.http.request("DELETE", f"{self.url}/storage/v1/object/{BUCKET}", headers=self._headers, json_body={"prefixes": paths[i : i + 100]}, ttl_seconds=0)

    def record_result(self, photo_id: str, job_id: str, outcome: str, note: str | None, prompt_version: str) -> None:
        self._rest(
            "POST",
            "photo_results",
            params={"on_conflict": "photo_id"},
            body={"photo_id": photo_id, "job_id": job_id, "outcome": outcome, "note": note, "prompt_version": prompt_version},
            prefer="resolution=merge-duplicates",
        )

    def insert_findings(self, rows: list[dict[str, Any]]) -> None:
        if rows:
            self._rest("POST", "findings", body=rows)

    # ---- janitor ----

    def expire_photos(self) -> int:
        return int(self._rpc("expire_photos") or 0)

    def queue_orphans(self) -> int:
        return int(self._rpc("queue_orphan_photos") or 0)

    def deletions(self, limit: int) -> list[tuple[int, str]]:
        rows = self._rest("GET", "storage_deletions", params={"select": "id,path", "bucket": f"eq.{BUCKET}", "order": "id", "limit": str(limit)})
        return [(int(r["id"]), r["path"]) for r in rows]

    def clear_deletions(self, ids: list[int]) -> None:
        if ids:
            self._rest("DELETE", "storage_deletions", params={"id": f"in.({','.join(map(str, ids))})"})

    # ---- insights (P3) ----

    def needing_insights(self, limit: int) -> list[dict[str, Any]]:
        return self._rpc("properties_needing_insights", {"max_rows": limit}) or []

    def reviewed_findings(self, property_id: str) -> list[tuple[int, str]]:
        """(condition, severity) of the findings an agent confirmed or edited."""
        rows = self._rest("GET", "findings", params={"select": "condition,severity", "property_id": f"eq.{property_id}", "status": "in.(confirmed,edited)"})
        return [(int(r["condition"]), r["severity"]) for r in rows]

    def upsert_insights(self, row: dict[str, Any]) -> None:
        # computed_at is sent explicitly: a merge only updates the columns it's given.
        body = {**row, "computed_at": datetime.now(UTC).isoformat()}
        self._rest("POST", "property_insights", params={"on_conflict": "property_id"}, body=body, prefer="resolution=merge-duplicates")

    # ---- reports (P5) ----

    def claim_report_job(self) -> ReportJob | None:
        rows = self._rpc("claim_report_job") or []
        if not rows:
            return None
        r = rows[0]
        budget = r.get("budget")
        return ReportJob(r["id"], r["property_id"], r.get("target_price"), float(budget) if budget is not None else None, r.get("days_to_list"))

    def report_inputs(self, property_id: str) -> dict[str, Any] | None:
        """Everything the report reads, as stored: no names, no address beyond ZIP and city."""
        prop = self._rest("GET", "properties", params={"select": "id,team_id,zip,city,place_id,facts,facts_confirmed_at", "id": f"eq.{property_id}"})
        if not prop:
            return None
        p = prop[0]
        team = p["team_id"]
        insights = self._rest("GET", "property_insights", params={"select": "valuation,segments,schools,amenities,sources,notes", "property_id": f"eq.{property_id}"})
        consent = self.processing_consent(property_id)
        findings = self._rest(
            "GET",
            "findings",
            params={"select": "room,category,condition,issue,suggested_fix,fix_item,quantity,severity,status", "property_id": f"eq.{property_id}", "status": "in.(confirmed,edited)"},
        ) if consent else []
        photos = self._rest("GET", "photos", params={"select": "room,photo_results(outcome)", "property_id": f"eq.{property_id}"}) if consent else []
        rooms = sorted({r["room"] for r in photos if any(x.get("outcome") == "analyzed" for x in _as_list(r.get("photo_results")))})
        return {
            "property": {k: p.get(k) for k in ("zip", "city", "place_id", "facts", "facts_confirmed_at")},
            "insights": insights[0] if insights else None,
            "findings": findings,
            "rooms_photographed": rooms,
            "cost_book": self._rest("GET", "cost_book", params={"select": "item,unit,low_usd,high_usd", "team_id": f"eq.{team}"}),
            "quotes": self._rest("GET", "quotes", params={"select": "item,low_usd,high_usd", "property_id": f"eq.{property_id}"}),
            "priors": self._rest("GET", "value_priors", params={"select": "item,recovery_low,recovery_high,source", "team_id": f"eq.{team}"}),
        }

    def update_report(self, report_id: str, **fields: Any) -> None:
        self._rest("PATCH", "reports", params={"id": f"eq.{report_id}"}, body=fields)


def _as_list(v: Any) -> list[dict[str, Any]]:
    """PostgREST embeds a one-to-one relation as an object, one-to-many as a list."""
    if v is None:
        return []
    return v if isinstance(v, list) else [v]
