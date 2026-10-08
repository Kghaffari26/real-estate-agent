"""Listing Prep P2 worker: server-side photo checks, the fair-housing screen (on the
labelled cases), the vision step through agents_core's LLM with a fake client, the
worker's consent and scope rules on an in-memory backend, the janitor, and the Supabase
client's requests (respx)."""

from __future__ import annotations

import io
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
import respx
from agents_core.costs import CostTracker, SpendScope
from agents_core.http import Http
from agents_core.llm import LLM
from PIL import Image

from agents.listing_prep import fair_housing
from agents.listing_prep import findings as vision
from agents.listing_prep.backend import BUCKET, ConsentRevoked, Job, PhotoRow, SupabaseBackend
from agents.listing_prep.photo_check import MODEL_MAX_EDGE, for_model, inspect
from agents.listing_prep.worker import NOTE_METADATA, janitor, process_job, run

CASES = Path(__file__).parent.parent / "evals" / "listing_prep" / "fair_housing_cases.jsonl"


def jpeg(w: int = 640, h: int = 480, *, exif: bool = False, gps: bool = False, fmt: str = "JPEG") -> bytes:
    img = Image.new("RGB", (w, h), (180, 150, 120))
    out = io.BytesIO()
    kwargs: dict[str, Any] = {}
    if exif or gps:
        e = Image.Exif()
        e[0x0110] = "Test Camera"  # Model
        if gps:
            e[0x8825] = {1: "N", 2: (33.0, 41.0, 15.0), 3: "W", 4: (117.0, 49.0, 30.0)}
        kwargs["exif"] = e.tobytes()
    img.save(out, format=fmt, **kwargs)
    return out.getvalue()


# ---------- photo checks ----------


def test_clean_photos_pass_and_metadata_is_caught():
    assert inspect(jpeg()).ok
    assert inspect(jpeg(fmt="WEBP")).ok
    camera = inspect(jpeg(exif=True))
    assert (camera.ok, camera.reason, camera.has_exif, camera.has_gps) == (False, "metadata", True, False)
    located = inspect(jpeg(gps=True))
    assert (located.ok, located.reason, located.has_gps) == (False, "metadata", True)
    assert inspect(b"not an image").reason == "unreadable"
    png = io.BytesIO()
    Image.new("RGB", (10, 10)).save(png, format="PNG")
    assert inspect(png.getvalue()).reason == "format"


def test_the_model_gets_pixels_only_within_the_long_edge():
    out = for_model(jpeg(4000, 3000, gps=True))
    check = inspect(out)
    assert check.ok and not check.has_exif and not check.has_gps
    assert max(check.width, check.height) == MODEL_MAX_EDGE


# ---------- fair housing ----------


def _cases():
    return [json.loads(line) for line in CASES.read_text(encoding="utf-8").splitlines() if line.strip()]


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c["text"][:40])
def test_fair_housing_cases(case):
    assert fair_housing.violations(case["text"]) == case["topics"]


def test_the_case_set_covers_every_topic_and_allowed_language():
    cases = _cases()
    covered = {t for c in cases for t in c["topics"]}
    assert covered == set(fair_housing.RULES)
    assert sum(1 for c in cases if not c["topics"]) >= 20


# ---------- the vision step ----------


def finding(**over: Any) -> dict[str, Any]:
    base = {
        "category": "cabinets",
        "condition": 2,
        "issue": "Cabinet doors are worn at the edges",
        "suggested_fix": "Refinish the cabinet doors",
        "fix_item": "cabinet_refinish",
        "quantity": 18,
        "severity": "cosmetic",
        "evidence": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.25},
        "confidence": "high",
    }
    return base | over


def test_screen_skips_people_and_unusable_photos_and_drops_out_of_scope_findings():
    items = {"cabinet_refinish": "linear_ft"}
    people = vision.screen(vision.PhotoAnalysis(people_visible=True, usable=True, findings=[vision.VisionFinding(**finding())]), items)
    assert (people.outcome, people.findings) == ("skipped_people", [])
    assert "People are visible" in (people.note or "")
    assert vision.screen(vision.PhotoAnalysis(people_visible=False, usable=False), items).outcome == "skipped_unusable"
    mixed = vision.PhotoAnalysis(
        people_visible=False,
        usable=True,
        findings=[
            vision.VisionFinding(**finding()),
            vision.VisionFinding(**finding(issue="Toys cover the family room floor", category="decluttering")),
            vision.VisionFinding(**finding(issue="Scuffed walls", suggested_fix="Repaint; great for young families", category="paint")),
            vision.VisionFinding(**finding(issue="Old faucet", fix_item="gold_plated_faucet", evidence={"x": 0.9, "y": 0.9, "w": 0.5, "h": 0.5})),
        ],
    )
    out = vision.screen(mixed, items)
    assert out.outcome == "analyzed"
    assert [f.issue for f in out.findings] == ["Cabinet doors are worn at the edges", "Old faucet"]
    assert out.dropped_fair_housing == 2
    assert out.note == "2 findings left out by the fair-housing check (condition and fixes only)."
    faucet = out.findings[1]
    assert faucet.fix_item is None  # not in the team's cost book
    assert faucet.evidence.x + faucet.evidence.w <= 1 and faucet.evidence.y + faucet.evidence.h <= 1


class FakeAnthropic:
    """messages.create for LLM.converse: answers with the next scripted tool input."""

    def __init__(self, answers: list[dict[str, Any] | None]) -> None:
        self.answers = list(answers)
        self.requests: list[dict[str, Any]] = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **params: Any) -> Any:
        self.requests.append(params)
        answer = self.answers.pop(0)
        usage = SimpleNamespace(input_tokens=1700, output_tokens=300, cache_creation_input_tokens=0, cache_read_input_tokens=0)
        if answer is None:
            return SimpleNamespace(content=[SimpleNamespace(type="text", text="I can't help with that.")], usage=usage, stop_reason="end_turn")
        block = SimpleNamespace(type="tool_use", id=f"t{len(self.requests)}", name="record_photo_findings", input=answer)
        return SimpleNamespace(content=[block], usage=usage, stop_reason="tool_use")


def llm_with(answers: list[dict[str, Any] | None], tmp_path: Path, max_usd: float = 1.0) -> tuple[LLM, FakeAnthropic, CostTracker]:
    client = FakeAnthropic(answers)
    tracker = CostTracker(agent="listing_prep_test", run_id="t", max_usd=max_usd, path=tmp_path / "costs.jsonl")
    return LLM(tracker, client=client), client, tracker


def test_analyze_photo_sends_the_image_and_tool_through_agents_core(tmp_path):
    llm, client, tracker = llm_with([None, {"people_visible": False, "usable": True, "findings": [finding()]}], tmp_path)
    out = vision.analyze_photo(llm, for_model(jpeg()), "kitchen", {"cabinet_refinish": "linear_ft"}, budget=SpendScope(tracker, 0.5))
    assert out.outcome == "analyzed" and len(out.findings) == 1 and out.usd > 0
    assert len(client.requests) == 2  # no tool call the first time: one retry
    req = client.requests[0]
    blocks = req["messages"][0]["content"]
    assert blocks[0]["type"] == "image" and blocks[0]["source"]["media_type"] == "image/jpeg"
    assert "cabinet_refinish (linear_ft)" in blocks[1]["text"]
    assert req["tools"][0]["name"] == "record_photo_findings"
    assert "people_visible" in req["system"][0]["text"]


def test_analyze_photo_gives_up_after_two_unusable_answers(tmp_path):
    llm, _, _ = llm_with([None, {"people_visible": "maybe"}], tmp_path)
    out = vision.analyze_photo(llm, for_model(jpeg()), "kitchen", {})
    assert (out.outcome, out.note) == ("skipped_unusable", vision.NOTES["no_answer"])


# ---------- the worker ----------


class MemoryBackend:
    def __init__(self, photos: dict[str, tuple[str, bytes | None]], *, revoke_after: int | None = None) -> None:
        self.photos = photos  # id -> (room, bytes)
        self.consent = True
        self.revoke_after = revoke_after
        self.checks = 0
        self.jobs = [Job("job-1", "prop-1")]
        self.job_updates: list[dict[str, Any]] = []
        self.results: dict[str, tuple[str, str | None]] = {}
        self.findings: list[dict[str, Any]] = []
        self.deleted: list[str] = []
        self.queue: list[tuple[int, str]] = [(1, "t/p/a.jpg"), (2, "t/p/b.jpg")]
        self.expired = 0

    def claim_job(self):
        return self.jobs.pop(0) if self.jobs else None

    def processing_consent(self, property_id):
        self.checks += 1
        if self.revoke_after is not None and len(self.results) >= self.revoke_after:
            self.consent = False
        return self.consent

    def pending_photos(self, property_id):
        return [PhotoRow(pid, room, f"t/p/{pid}.jpg") for pid, (room, _) in self.photos.items() if pid not in self.results]

    def team_cost_items(self, property_id):
        return {"cabinet_refinish": "linear_ft"}

    def download(self, path):
        return self.photos[path.split("/")[-1].removesuffix(".jpg")][1]

    def delete_objects(self, paths):
        self.deleted += paths

    def record_result(self, photo_id, job_id, outcome, note, prompt_version):
        if not self.consent:
            raise ConsentRevoked()
        self.results[photo_id] = (outcome, note)

    def insert_findings(self, rows):
        if not self.consent:
            raise ConsentRevoked()
        self.findings += rows

    def update_job(self, job_id, **fields):
        self.job_updates.append(fields)

    def expire_photos(self):
        return self.expired

    def queue_orphans(self):
        return 0

    def deletions(self, limit):
        batch, self.queue = self.queue[:limit], self.queue[limit:]
        return batch

    def clear_deletions(self, ids):
        pass

    def record_spend(self, property_id, kind, ref, usd):
        self.spend = [*getattr(self, "spend", []), (kind, ref, usd)]


def scoped(tracker):
    return lambda usd, label: SpendScope(tracker, usd, label=label)


def test_a_job_analyzes_clean_photos_skips_people_and_rejects_metadata(tmp_path):
    backend = MemoryBackend(
        {
            "kitchen1": ("kitchen", jpeg()),
            "living1": ("living", jpeg()),
            "gps1": ("bath", jpeg(gps=True)),
            "gone": ("yard", None),
        }
    )
    answers = [
        {"people_visible": False, "usable": True, "findings": [finding(), finding(issue="Christmas decorations crowd the counter", category="decluttering")]},
        {"people_visible": True, "usable": True, "findings": [finding()]},
    ]
    llm, client, tracker = llm_with(answers, tmp_path)
    report = process_job(backend, llm, Job("job-1", "prop-1"), scope_factory=scoped(tracker))
    assert report.status == "done"
    assert (report.analyzed, report.skipped, report.rejected, report.findings, report.dropped_fair_housing) == (1, 2, 1, 1, 1)
    assert len(client.requests) == 2  # the GPS photo and the missing file never reached the model
    assert backend.results["living1"][0] == "skipped_people"
    assert backend.results["gps1"] == ("rejected_metadata", NOTE_METADATA)
    assert backend.deleted == ["t/p/gps1.jpg"]
    assert backend.results["gone"][0] == "skipped_unusable"
    assert backend.findings[0]["issue"] == "Cabinet doors are worn at the edges"
    assert backend.findings[0]["prompt_version"] == vision.PROMPT_VERSION
    assert backend.job_updates[-1]["status"] == "done"


def test_consent_is_checked_before_every_photo(tmp_path):
    backend = MemoryBackend({"a": ("kitchen", jpeg()), "b": ("kitchen", jpeg()), "c": ("kitchen", jpeg())}, revoke_after=1)
    llm, client, tracker = llm_with([{"people_visible": False, "usable": True, "findings": [finding()]}] * 3, tmp_path)
    report = process_job(backend, llm, Job("job-1", "prop-1"), scope_factory=scoped(tracker))
    assert report.status == "cancelled"
    assert list(backend.results) == ["a"] and len(client.requests) == 1
    assert backend.job_updates[-1] | {"finished_at": None} == {"status": "cancelled", "error": "consent_revoked", "finished_at": None}


def test_no_consent_no_model_call(tmp_path):
    backend = MemoryBackend({"a": ("kitchen", jpeg())})
    backend.consent = False
    llm, client, _ = llm_with([], tmp_path)
    assert process_job(backend, llm, Job("job-1", "prop-1")).status == "cancelled"
    assert client.requests == []


def test_the_run_cap_fails_the_job_not_the_run(tmp_path):
    backend = MemoryBackend({"a": ("kitchen", jpeg())})
    llm, client, tracker = llm_with([{"people_visible": False, "usable": True, "findings": []}], tmp_path, max_usd=0.0001)
    report = process_job(backend, llm, Job("job-1", "prop-1"), scope_factory=scoped(tracker))
    assert report.status == "failed" and client.requests == []
    assert backend.job_updates[-1]["error"] == "budget"


def test_janitor_deletes_queued_files_and_run_skips_jobs_without_a_model(tmp_path):
    backend = MemoryBackend({"a": ("kitchen", jpeg())})
    backend.expired = 2
    summary = run(backend, None)
    assert summary == {"janitor": {"expired": 2, "orphans": 0, "files_deleted": 2}, "jobs": [], "insights": 0, "reports": []}
    assert backend.deleted == ["t/p/a.jpg", "t/p/b.jpg"]
    assert backend.jobs  # still queued
    assert janitor(backend)["files_deleted"] == 0


# ---------- the Supabase client ----------

URL = "https://proj.supabase.test"


@respx.mock
def test_supabase_backend_requests():
    b = SupabaseBackend(Http(), URL, "service-key-for-tests")
    claim = respx.post(f"{URL}/rest/v1/rpc/claim_vision_job").mock(return_value=httpx.Response(200, json=[{"id": "j1", "property_id": "p1", "status": "running"}]))
    assert b.claim_job() == Job("j1", "p1")
    assert claim.calls[0].request.headers["apikey"] == "service-key-for-tests"
    assert claim.calls[0].request.headers["authorization"] == "Bearer service-key-for-tests"
    respx.get(f"{URL}/rest/v1/photos").mock(
        return_value=httpx.Response(200, json=[{"id": "a", "room": "kitchen", "storage_path": "t/p/a.jpg", "photo_results": []}, {"id": "b", "room": "bath", "storage_path": "t/p/b.jpg", "photo_results": [{"photo_id": "b"}]}])
    )
    assert b.pending_photos("p1") == [PhotoRow("a", "kitchen", "t/p/a.jpg")]
    respx.get(f"{URL}/storage/v1/object/authenticated/{BUCKET}/t/p/x.jpg").mock(return_value=httpx.Response(404))
    assert b.download("t/p/x.jpg") is None
    respx.post(f"{URL}/rest/v1/findings").mock(return_value=httpx.Response(403, json={"code": "42501", "message": "consent revoked"}))
    with pytest.raises(ConsentRevoked):
        b.insert_findings([{"property_id": "p1"}])
    delete = respx.delete(f"{URL}/storage/v1/object/{BUCKET}").mock(return_value=httpx.Response(200, json=[]))
    b.delete_objects([f"t/p/{i}.jpg" for i in range(150)])
    assert [len(json.loads(c.request.content)["prefixes"]) for c in delete.calls] == [100, 50]
    clear = respx.delete(f"{URL}/rest/v1/storage_deletions").mock(return_value=httpx.Response(204))
    b.clear_deletions([3, 4])
    assert clear.calls[0].request.url.params["id"] == "in.(3,4)"
