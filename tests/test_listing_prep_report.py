"""The report agent (Listing Prep P5): tools, the loop end to end on a scripted model,
the structure / fair-housing / number checks, the reviewer, and the template fallback.
Fixtures are fictional (`evals/listing_prep/report_fixtures.py`)."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from agents_core.agent_loop import LoopBudget
from agents_core.costs import CostTracker
from agents_core.guards import verify_numbers
from agents_core.llm import LLM, tier_config
from pydantic import ValidationError

from agents.listing_prep import fair_housing
from agents.listing_prep import report as R
from evals.listing_prep.report_fixtures import WORLDS

RESEARCH = [
    "get_property", "get_market_context", "find_comparables", "get_competing_listings", "get_buyer_demand",
    "get_schools", "get_amenities", "get_findings", "estimate_items", "optimize_budget",
]


class ScriptedClient:
    """messages.create answering with scripted turns: a list of (name, input) tool calls,
    or a str (a text-only turn), or ("refusal",)."""

    def __init__(self, turns: list[Any]) -> None:
        self.turns = list(turns)
        self.requests: list[dict[str, Any]] = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **params: Any) -> Any:
        self.requests.append(params)
        if not self.turns:
            raise AssertionError("the script ran out")
        turn = self.turns.pop(0)
        usage = SimpleNamespace(input_tokens=3000, output_tokens=400, cache_creation_input_tokens=0, cache_read_input_tokens=0)
        if turn == ("refusal",):
            return SimpleNamespace(content=[SimpleNamespace(type="text", text="No.")], usage=usage, stop_reason="refusal", stop_details=None)
        if isinstance(turn, str):
            return SimpleNamespace(content=[SimpleNamespace(type="text", text=turn)], usage=usage, stop_reason="end_turn", stop_details=None)
        n = len(self.requests)
        blocks = [SimpleNamespace(type="tool_use", id=f"t{n}_{i}", name=name, input=inp) for i, (name, inp) in enumerate(turn)]
        return SimpleNamespace(content=blocks, usage=usage, stop_reason="tool_use", stop_details=None)


def llm_with(turns: list[Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[LLM, ScriptedClient]:
    monkeypatch.setenv("AGENTS_CORE_DATA_DIR", str(tmp_path))
    client = ScriptedClient(turns)
    return LLM(CostTracker(agent="t", run_id="t", max_usd=5.0, path=tmp_path / "c.jsonl"), client=client), client


def research_turns() -> list[Any]:
    return [[(name, {}) for name in RESEARCH], [("evidence_gaps", {})]]


def draft_input(world: R.ReportWorld, **changes: Any) -> dict[str, Any]:
    d = R.template_draft(world).model_dump()
    d.update(changes)
    return d


REVIEW_OK = [("record_review", {"compliant": True, "issues": []})]


# ---- the tools ----------------------------------------------------------------------------


def test_tools_return_human_units_and_say_what_is_unavailable():
    box = R.Toolbox(WORLDS["full"])
    m = box.get_market_context()
    assert m["zip_market"]["median_sale_price"] == {"label": "Median sale price", "value": 1385000, "yoy_pct": 3.1, "unit": "USD"}
    assert m["zip_market"]["avg_sale_to_list"]["value"] == 99.1 and m["zip_market"]["avg_sale_to_list"]["yoy_pp"] == -0.6
    assert m["zip_market"]["median_dom"] == {"label": "Median days on market", "value": 31, "yoy_change": 4.0, "unit": "days"}
    assert box.find_comparables(R.CompQuery())["available"] is False
    assert box.get_competing_listings(R.ListingQuery())["available"] is False
    demand = box.get_buyer_demand()
    assert [s["share_of_demand_pct"] for s in demand["segments"]] == [38, 29, 21, 12]
    findings = box.get_findings(R.FindingQuery())
    assert "family room" in findings["by_room"] and "family" not in findings["by_room"]  # rooms read as rooms
    assert findings["rooms_not_photographed"] == []
    items = {i["key"]: i for i in box.estimate_items_tool()["items"]}
    assert items["countertop_quartz_install"]["cost_source"] == "quote" and items["countertop_quartz_install"]["status"] == "avoid"
    assert items["professional_cleaning"]["roi_pct"] == 50.0
    plans = box.optimize_budget(R.BudgetQuery(budgets=[15_000]))
    assert [p["budget"] for p in plans["scenarios"]] == [5000, 10000, 15000, 25000, 50000]
    assert all(p["cost_high"] <= p["budget"] for p in plans["scenarios"])
    assert next(p for p in plans["scenarios"] if p["budget"] == 25000)["is_seller_budget"]


def test_evidence_gaps_track_research_and_report_data_gaps():
    box = R.Toolbox(WORLDS["rushed"])
    first = box.evidence_gaps()
    assert first["research_remaining"] == list(R.RESEARCH_TOOLS) and not first["done"]
    gaps = " | ".join(g["gap"] for g in first["data_gaps"])
    assert "Rooms without photos: living room, primary bedroom, primary bath" in gaps
    assert "Can't finish before listing: Refinish kitchen cabinets" in gaps
    box.get_property()
    assert "get_property" not in box.evidence_gaps()["research_remaining"]
    nd = " | ".join(g["gap"] for g in R.Toolbox(WORLDS["no-demand"]).data_gaps())
    assert "Buyer demand isn't sized" in nd and "Few sales in this ZIP" in nd
    assert "No value range" in R.Toolbox(WORLDS["no-value"]).data_gaps()[0]["gap"]
    assert all(e.status == "no_prior" or e.status == "no_price" for e in R.Toolbox(WORLDS["no-priors"]).estimates())


# ---- the template, on every fixture ----------------------------------------------------------


@pytest.mark.parametrize("name", sorted(WORLDS))
def test_template_reports_pass_every_check_and_assemble(name):
    world = WORLDS[name]
    draft = R.template_draft(world)
    box = R.Toolbox(world)
    for t in RESEARCH:
        getattr(box, {"estimate_items": "estimate_items_tool"}.get(t, t))(*([R.FindingQuery()] if t == "get_findings" else [R.BudgetQuery()] if t == "optimize_budget" else [R.CompQuery()] if t == "find_comparables" else [R.ListingQuery()] if t == "get_competing_listings" else []))
    box.evidence_gaps()
    assert R.number_guard(box)(draft).ok
    assert not fair_housing.screen(R.narrative_texts(draft), scope="report")
    R.ReportDraft.model_validate(draft.model_dump())  # the finish rules hold for the fallback too
    rep = R.assemble(world, draft, source="template")
    assert set(rep["sections"]) == {"snapshot", "buyers", "market", "improvements", "budget", "highest_roi", "avoid", "strategy", "outcome"}
    assert rep["disclaimer"].startswith("This is a market analysis") and "not an appraisal" in rep["disclaimer"]
    assert rep["gaps"]["data"] and len(draft.gaps) == min(8, len(rep["gaps"]["data"]))
    assert len(json.dumps(rep)) < 60_000


def test_template_says_not_enough_evidence_without_priors():
    d = R.template_draft(WORLDS["no-priors"])
    assert "No item has a positive risk-adjusted return" in d.highest_roi
    assert any("Not enough evidence" in n.reasoning for n in d.improvements)
    assert any(g.startswith("No value prior") for g in d.gaps)


# ---- the finish rules -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "field,text,expect",
    [
        ("snapshot", "The value range is $1,195,000 to $1,615,000, which is ideal for a young family.", "fair housing"),
        ("market", "It sits in a safe neighborhood with great schools nearby, close to transit.", "fair housing"),
        ("buyers", "Work from home is 29% of estimated demand, 2 times the share of luxury buyers.", "multiples"),
        ("outcome", "With the plan, the home will sell for more than the target price of $1,450,000.", "promises"),
        ("budget", "The $25,000 plan is guaranteed to pay off at the conservative end of its range.", "promises"),
    ],
)
def test_finish_rules_reject_with_a_reason_the_model_can_act_on(field, text, expect):
    with pytest.raises(ValidationError) as e:
        R.ReportDraft.model_validate(draft_input(WORLDS["full"], **{field: text}))
    assert expect in str(e.value)


def test_finish_rules_allow_distances_to_schools_but_not_ratings():
    ok = "Fixture Elementary is 0.4 miles away and a park is 0.2 miles away, both within a 20-minute walk."
    R.ReportDraft.model_validate(draft_input(WORLDS["full"], market=ok))
    assert fair_housing.violations("schools within a mile", scope="report") == []
    assert fair_housing.violations("schools within a mile") == ["neighborhood"]  # findings stay stricter
    for bad in ("top-rated schools", "in a sought-after school district", "a family neighborhood", "perfect for retirees"):
        assert fair_housing.violations(bad, scope="report"), bad


def test_finish_model_only_accepts_items_the_tools_returned():
    model = R.finish_model(["interior_paint_walls"], None)
    good = draft_input(WORLDS["full"], improvements=[{"key": "interior_paint_walls", "reasoning": "Walls are scuffed in the living room."}])
    model.model_validate(good)
    with pytest.raises(ValidationError):
        model.model_validate(good | {"improvements": [{"key": "pool_install", "reasoning": "A pool would help it sell."}]})
    assert "interior_paint_walls" in json.dumps(model.model_json_schema())


def test_number_guard_catches_an_invented_figure():
    world = WORLDS["full"]
    box = R.Toolbox(world)
    box.get_property()
    bad = R.ReportDraft.model_validate(draft_input(world, snapshot="The home is likely worth $1,512,000 after a $7,700 refresh of the walls."))
    res = R.number_guard(box)(bad)
    assert not res.ok and "$1,512,000" in res.unsupported


# ---- the loop, end to end on a scripted model ----------------------------------------------------


def test_the_loop_researches_then_finishes_and_the_review_passes(tmp_path, monkeypatch):
    world = WORLDS["full"]
    llm, client = llm_with([*research_turns(), [("finish", draft_input(world))], REVIEW_OK], tmp_path, monkeypatch)
    rep = R.run_report(llm, world)
    assert rep["narrative_source"] == "llm" and rep["stop_reason"] == "finished" and rep["warnings"] == []
    assert rep["tools_called"] == [*RESEARCH, "evidence_gaps"]
    assert rep["review_calls"] == 1 and rep["cost_usd"] > 0 and rep["model"] == tier_config("smart").model
    # The loop runs on the smart tier; the review on the fast tier, with the narrative only.
    assert client.requests[0]["model"] == tier_config("smart").model
    review_req = client.requests[3]
    assert review_req["model"] == tier_config("fast").model and review_req["tools"][0]["name"] == "record_review"
    assert "Report narrative to review" in json.dumps(review_req["messages"][0]["content"])
    # The finish schema lists this property's item keys.
    finish = next(t for t in client.requests[0]["tools"] if t["name"] == "finish")
    assert "interior_paint_walls" in json.dumps(finish["input_schema"])
    # No address, names or ids reach the model: only ZIP, city, facts, findings and computed figures.
    sent = json.dumps(client.requests[2]["messages"])
    assert "92618" in sent and "address" not in sent.lower()


def test_review_issues_go_back_to_the_model_and_a_clean_rewrite_passes(tmp_path, monkeypatch):
    world = WORLDS["full"]
    flagged = [("record_review", {"compliant": False, "issues": [{"quote": "Lead with the features", "reason": "implies a preferred buyer"}]})]
    llm, client = llm_with([*research_turns(), [("finish", draft_input(world))], flagged, [("finish", draft_input(world))], REVIEW_OK], tmp_path, monkeypatch)
    rep = R.run_report(llm, world)
    assert rep["narrative_source"] == "llm" and rep["review_calls"] == 2
    err = client.requests[4]["messages"][-1]["content"][0]
    assert err["is_error"] and "fair-housing review found" in err["content"] and "implies a preferred buyer" in err["content"]


def test_fair_housing_rule_failure_is_explained_before_any_review(tmp_path, monkeypatch):
    world = WORLDS["full"]
    bad = draft_input(world, buyers="This home is perfect for empty nesters who want a quiet street.")
    llm, client = llm_with([*research_turns(), [("finish", bad)], [("finish", draft_input(world))], REVIEW_OK], tmp_path, monkeypatch)
    rep = R.run_report(llm, world)
    assert rep["narrative_source"] == "llm" and rep["review_calls"] == 1  # the rules caught it; no review spent on it
    err = client.requests[3]["messages"][-1]["content"][0]["content"]
    assert "fair housing (familial)" in err or "fair housing (steering)" in err


def test_an_invented_number_twice_falls_back_to_the_template(tmp_path, monkeypatch):
    world = WORLDS["full"]
    bad = draft_input(world, outcome="The work adds about $61,000 to the price, at Low confidence, from the team's priors.")
    llm, _ = llm_with([*research_turns(), [("finish", bad)], REVIEW_OK, [("finish", bad)], REVIEW_OK], tmp_path, monkeypatch)
    rep = R.run_report(llm, world)
    assert rep["narrative_source"] == "template" and "number check" in rep["warnings"][0]
    assert rep["sections"]["outcome"]["narrative"] == R.template_draft(world).outcome


def test_no_review_answer_means_the_template_is_published(tmp_path, monkeypatch):
    world = WORLDS["condo-small"]
    llm, _ = llm_with([*research_turns(), [("finish", draft_input(world))], ("refusal",)], tmp_path, monkeypatch)
    rep = R.run_report(llm, world)
    assert rep["narrative_source"] == "template" and "fair-housing review couldn't run" in rep["warnings"][0]


def test_a_loop_that_stops_early_publishes_the_template(tmp_path, monkeypatch):
    world = WORLDS["no-demand"]
    llm, _ = llm_with(["I think the home is fine."], tmp_path, monkeypatch)
    rep = R.run_report(llm, world)
    assert rep["narrative_source"] == "template" and rep["stop_reason"] == "end_turn_without_finish"
    assert "stopped early" in rep["warnings"][0]
    llm, _ = llm_with([[("get_property", {})]] * 3, tmp_path, monkeypatch)
    rep = R.run_report(llm, world, budget=LoopBudget(max_steps=3, max_usd=0.75, max_seconds=60))
    assert rep["stop_reason"] == "max_steps" and rep["narrative_source"] == "template"


def test_without_a_model_the_report_is_the_template():
    rep = R.run_report(None, WORLDS["no-value"])
    assert rep["narrative_source"] == "template" and rep["stop_reason"] == "not_run" and rep["cost_usd"] == 0
    assert rep["sections"]["outcome"]["value_now"] is None


def test_template_numbers_all_come_from_the_tools():
    """Belt and braces for the fallback: every figure in its text is in a tool output."""
    for world in WORLDS.values():
        d = R.template_draft(world)
        box = R.Toolbox(world)
        box.get_property(), box.get_market_context(), box.get_buyer_demand(), box.estimate_items_tool(), box.evidence_gaps()
        box.get_findings(R.FindingQuery()), box.optimize_budget(R.BudgetQuery())
        text = "\n".join(R.narrative_texts(d))
        assert verify_numbers(text, R._guard_facts({"seen": box.seen}), allow=R.GUARD_ALLOW).ok


# ---- replay of live recordings (evals/listing_prep/trajectories/, LP_SAVE_TRAJECTORIES) -----------

TRAJECTORIES = Path(__file__).parent.parent / "evals" / "listing_prep" / "trajectories"
RECORDED = sorted(p.stem for p in TRAJECTORIES.glob("*.json") if not p.name.endswith(".review.json")) if TRAJECTORIES.exists() else []


class _RoutingReplay:
    """The loop's recorded responses for loop requests, the reviewer's for review requests."""

    def __init__(self, loop_path: Path, review: list[dict[str, Any]]) -> None:
        from agents_core.agent_loop import ReplayClient

        self.loop = ReplayClient(loop_path, strict=True)
        self.review = ReplayClient(review, strict=False)
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **params: Any) -> Any:
        if params.get("tools") and params["tools"][0]["name"] == "record_review":
            return self.review.messages.create(**params)
        return self.loop.messages.create(**params)


@pytest.mark.skipif(not RECORDED, reason="no live recordings yet (run REPORT_AGENT with LP_SAVE_TRAJECTORIES)")
@pytest.mark.parametrize("case_id", RECORDED or ["none"])
def test_recorded_trajectories_replay_deterministically(case_id, tmp_path, monkeypatch):
    from agents_core.agent_loop import Trajectory

    from evals.listing_prep import suites

    case = next(c for c in suites.REPORT_AGENT.cases if c.id == case_id)
    world = WORLDS[case.input["world"]]
    path = TRAJECTORIES / f"{case_id}.json"
    review = json.loads((TRAJECTORIES / f"{case_id}.review.json").read_text())
    monkeypatch.setenv("AGENTS_CORE_DATA_DIR", str(tmp_path))
    llm = LLM(CostTracker(agent="t", run_id="t", path=tmp_path / "c.jsonl"), client=_RoutingReplay(path, review))
    loop, box, reviewer = R.build_loop(llm, world)
    result = loop.run(R.task_prompt(world))
    recorded = [b["name"] for r in Trajectory.load(path).responses for b in r["content"] if b.get("type") == "tool_use"]
    assert result.tools_called() == [t for t in recorded if t != "finish"]
    assert result.ok and result.narrative_source == "llm" and reviewer.last_ok is True
    assert set(suites.REQUIRED_TOOLS) <= set(result.tools_called()) and result.steps <= R.BUDGET.max_steps
    assert R.number_guard(box)(result.result).ok
    assert not fair_housing.screen(R.narrative_texts(result.result), scope="report")


# ---- the worker: world building and report jobs ---------------------------------------------------

from agents.listing_prep import worker  # noqa: E402
from agents.listing_prep.backend import ReportJob  # noqa: E402

REGION = {
    "data_through": "2026-08-31",
    "zips": [{"id": "92618", "city": "Irvine", "low_sample": False, "latest": {"median_sale_price": {"value": 1385000, "yoy": 0.0312}}}],
    "cities": [{"id": "0636770", "name": "Irvine", "latest": {"median_sale_price": {"value": 1420000, "yoy": 0.0241}}}],
}


def inputs(**over: Any) -> dict[str, Any]:
    base = {
        "property": {"zip": "92618", "city": "Irvine", "place_id": "0636770", "facts": {"beds": 3, "baths": 2, "sqft": 1700, "year_built": 1984, "property_type": "townhouse"}, "facts_confirmed_at": "2026-10-05T10:00:00Z"},
        "insights": {"valuation": {"low": 950000, "high": 1290000, "method": "zip_ppsf", "confidence": "low", "interval": "rough"}, "segments": None, "schools": None, "amenities": None, "sources": ["Redfin"], "notes": ["Buyer demand needs the Census key (CENSUS_API_KEY) or the Census service was unavailable."]},
        "findings": [{"room": "kitchen", "category": "lighting", "condition": 2, "issue": "Fluorescent box light", "suggested_fix": "Replace", "fix_item": "light_fixture_replace", "quantity": None, "severity": "cosmetic", "status": "confirmed"}],
        "rooms_photographed": ["kitchen", "exterior_front"],
        "cost_book": [{"item": "light_fixture_replace", "unit": "each", "low_usd": "150.00", "high_usd": "350.00"}, {"item": "professional_cleaning", "unit": "each", "low_usd": None, "high_usd": None}],
        "quotes": [],
        "priors": [{"item": "light_fixture_replace", "recovery_low": "1.050", "recovery_high": "1.400", "source": "Team experience 2025"}],
    }
    return base | over


def test_build_world_reads_the_stored_rows_and_the_region():
    w = R.build_world(inputs(), REGION, R.Goal(target_price=1_200_000, budget=5_000, days_to_list=10))
    assert (w.zip, w.city, w.data_through) == ("92618", "Irvine", "2026-08-31")
    assert w.zip_market["median_sale_price"]["value"] == 1385000 and w.city_market["median_sale_price"]["value"] == 1420000
    assert w.cost_book["light_fixture_replace"] == {"unit": "each", "low": 150.0, "high": 350.0}
    assert w.cost_book["professional_cleaning"] == {"unit": "each", "low": None, "high": None}
    assert w.priors["light_fixture_replace"]["recovery_low"] == 1.05
    assert w.segments is None and "Census" in w.insight_notes[0]
    assert "address" not in w.model_dump_json()
    est = {e.key: e.status for e in R.Toolbox(w).estimates()}
    assert est["light_fixture_replace"] == "candidate" and est["professional_cleaning"] == "no_price"
    assert R.build_world(inputs(), None, R.Goal()).zip_market is None  # no region data: no market figures, no failure


class ReportBackend:
    def __init__(self, jobs: list[ReportJob], data: dict[str, Any] | None) -> None:
        self.jobs = list(jobs)
        self.data = data
        self.updates: list[tuple[str, dict[str, Any]]] = []

    def claim_report_job(self):
        return self.jobs.pop(0) if self.jobs else None

    def report_inputs(self, property_id):
        return self.data

    def update_report(self, report_id, **fields):
        self.updates.append((report_id, fields))

    # The rest of the worker's backend, idle here.
    def expire_photos(self):
        return 0

    def queue_orphans(self):
        return 0

    def deletions(self, limit):
        return []

    def claim_job(self):
        return None

    def needing_insights(self, limit):
        return []


def test_a_report_job_runs_the_agent_and_stores_the_report(tmp_path, monkeypatch):
    world = R.build_world(inputs(), REGION, R.Goal(target_price=1_200_000, budget=5_000, days_to_list=10))
    llm, client = llm_with([*research_turns(), [("finish", draft_input(world))], REVIEW_OK], tmp_path, monkeypatch)
    backend = ReportBackend([ReportJob("r1", "p1", 1_200_000, 5000.0, 10)], inputs())
    http = SimpleNamespace(get_json=lambda url, ttl_seconds=0: REGION)  # the published region data, fetched once
    summary = worker.run(backend, llm, http=http)
    assert summary["reports"][0]["status"] == "done" and summary["reports"][0]["narrative_source"] == "llm"
    rid, fields = backend.updates[-1]
    assert rid == "r1" and fields["status"] == "done" and fields["prompt_version"] == R.PROMPT_VERSION
    assert fields["output"]["goal"] == {"target_price": 1200000, "budget": 5000, "days_to_list": 10}
    assert fields["usd"] > 0 and json.dumps(fields["output"])  # JSON-serializable for PostgREST


def test_report_jobs_cancel_when_facts_were_unconfirmed_and_fail_cleanly(tmp_path, monkeypatch):
    unconfirmed = inputs(property=inputs()["property"] | {"facts_confirmed_at": None})
    backend = ReportBackend([ReportJob("r1", "p1")], unconfirmed)
    llm, client = llm_with([], tmp_path, monkeypatch)
    assert worker.run(backend, llm)["reports"] == [{"id": "r1", "status": "cancelled", "usd": 0.0}]
    assert backend.updates[0][1]["error"] == "facts_unconfirmed" and client.requests == []

    backend = ReportBackend([ReportJob("r2", "p1")], inputs())
    monkeypatch.setattr(R, "run_report", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    assert worker.run(backend, llm)["reports"][0]["status"] == "failed"
    assert backend.updates[-1][1]["error"] == "worker_error"


def test_reports_are_claimed_only_while_the_run_can_pay_for_one(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENTS_CORE_DATA_DIR", str(tmp_path))
    client = ScriptedClient([])
    llm = LLM(CostTracker(agent="t", run_id="t", max_usd=0.50, path=tmp_path / "c.jsonl"), client=client)
    backend = ReportBackend([ReportJob("r1", "p1")], inputs())
    assert worker.run(backend, llm)["reports"] == [] and backend.jobs  # left queued for the next run
    assert worker.run(backend, None)["reports"] == []  # no key: reports stay queued
