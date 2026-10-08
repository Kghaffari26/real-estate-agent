"""The Listing Prep report agent's eval suites (SPEC_LISTING_PREP.md §6), on `agents_core.evals`.

    uv run agents-evals run evals.listing_prep.suites:TEMPLATE_REPORTS   # free, offline
    uv run agents-evals run evals.listing_prep.suites:REPORT_AGENT       # ~$1.50 (6 reports, smart tier)

Six fictional fixture properties (`report_fixtures.py`), each a situation the report must
handle honestly (everything available, a small budget, no value priors, no demand data,
no time, no value range). Graded for: evidence use (the research tools called, an LLM
judge), the number guard, fair housing (the rule screen, and in the agent suite the
reviewer having passed it), uncertainty statements (confidence named, every data gap
stated), structure, and the case's own expectations (e.g. "not enough evidence" when the
team has no priors).

`TEMPLATE_REPORTS` grades the deterministic fallback every report can end in.
`REPORT_AGENT` runs the real loop; with `LP_SAVE_TRAJECTORIES=<dir>` it saves each
loop's trajectory and the reviewer's responses (`<id>.json`, `<id>.review.json`), which
`tests/test_listing_prep_report.py` replays offline.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from agents_core.agent_loop import LoopResult
from agents_core.evals import (
    EvalCase,
    EvalContext,
    EvalOutput,
    EvalSuite,
    LLMJudge,
    Score,
    Scorer,
    load_cases,
    max_steps,
    required_tools_called,
    stop_reason,
)
from agents_core.guards import verify_numbers

from agents.listing_prep import fair_housing
from agents.listing_prep import report as R
from evals.listing_prep.report_fixtures import WORLDS

HERE = Path(__file__).resolve().parent
SAVE_TRAJECTORIES = os.environ.get("LP_SAVE_TRAJECTORIES")
REQUIRED_TOOLS = ["get_property", "get_market_context", "get_findings", "estimate_items", "optimize_budget", "evidence_gaps"]


class Check(Scorer):
    """A pass/fail scorer from `(case, output) -> (passed, detail)`."""

    def __init__(self, name: str, fn: Any) -> None:
        self.name, self.fn = name, fn

    def score(self, case: EvalCase, out: EvalOutput, ctx: EvalContext) -> Score:
        passed, detail = self.fn(case, out.output)
        return self._result(1.0 if passed else 0.0, bool(passed), str(detail))


def _all_seen(world: R.ReportWorld) -> list[Any]:
    """Every tool output for this world (what any run could have seen)."""
    box = R.Toolbox(world)
    box.get_property(), box.get_market_context(), box.find_comparables(R.CompQuery()), box.get_competing_listings(R.ListingQuery())
    box.get_buyer_demand(), box.get_schools(), box.get_amenities(), box.get_findings(R.FindingQuery())
    box.estimate_items_tool(), box.optimize_budget(R.BudgetQuery()), box.evidence_gaps()
    return box.seen


def _output(world: R.ReportWorld, draft: R.ReportDraft, source: str, seen: list[Any]) -> dict[str, Any]:
    return {
        "narrative": draft.model_dump(),
        "texts": R.narrative_texts(draft),
        "narrative_source": source,
        "data_gaps": [g["gap"] for g in R.Toolbox(world).data_gaps()],
        "evidence": seen,
    }


# ---- tasks ------------------------------------------------------------------------------------


def _template(case: EvalCase, ectx: EvalContext) -> dict[str, Any]:
    world = WORLDS[case.input["world"]]
    return _output(world, R.template_draft(world), "template", _all_seen(world))


def _agent(case: EvalCase, ectx: EvalContext) -> EvalOutput:
    world = WORLDS[case.input["world"]]
    loop, box, reviewer = R.build_loop(ectx.llm, world)
    result: LoopResult[R.ReportDraft] = loop.run(R.task_prompt(world))
    if SAVE_TRAJECTORIES:
        result.trajectory.save(Path(SAVE_TRAJECTORIES) / f"{case.id}.json")
        (Path(SAVE_TRAJECTORIES) / f"{case.id}.review.json").write_text(json.dumps(reviewer.recorded if reviewer else [], indent=2))
    reviewed = reviewer is None or reviewer.last_ok is True
    if result.ok and result.result is not None and result.narrative_source == "llm" and reviewed:
        draft, source = result.result, "llm"
    else:
        draft, source = R.template_draft(world), "template"
    out = _output(world, draft, source, box.seen if source == "llm" else _all_seen(world))
    out["review_calls"] = reviewer.calls if reviewer else 0
    return EvalOutput(out, loop=result)


# ---- checks ---------------------------------------------------------------------------------------


def _numbers(case: EvalCase, out: dict[str, Any]) -> tuple[bool, Any]:
    res = verify_numbers("\n".join(out["texts"]), R._guard_facts({"seen": out["evidence"]}), allow=R.GUARD_ALLOW)
    return res.ok, res.unsupported or "all figures from the tools"


def _fair_housing(case: EvalCase, out: dict[str, Any]) -> tuple[bool, Any]:
    hits = fair_housing.explain(out["texts"], scope="report")
    return not hits, hits or "clean"


def _structure(case: EvalCase, out: dict[str, Any]) -> tuple[bool, Any]:
    try:
        R.ReportDraft.model_validate(out["narrative"])
    except ValueError as e:
        return False, str(e)[:300]
    return True, "valid"


def _uncertainty(case: EvalCase, out: dict[str, Any]) -> tuple[bool, Any]:
    """Confidence is named, and the gaps list covers the data gaps (up to 8)."""
    text = " ".join(out["texts"]).lower()
    named = "confidence" in text or "rough" in text or "not enough" in text
    need = min(len(out["data_gaps"]), 8)
    stated = len(out["narrative"]["gaps"])
    return named and stated >= need, f"confidence named: {named}; gaps stated {stated} of {need}"


def _mentions(case: EvalCase, out: dict[str, Any]) -> tuple[bool, Any]:
    text = " ".join(out["texts"]).lower()
    missing = [group for group in (case.expected or {}).get("mention_any", []) if not any(p.lower() in text for p in group)]
    return not missing, missing or "all mentioned"


def _guard_passed(case: EvalCase, out: dict[str, Any]) -> tuple[bool, Any]:
    return out["narrative_source"] == "llm", out["narrative_source"]


TEMPLATE_CHECKS: list[Scorer] = [
    Check("number_fidelity", _numbers),
    Check("fair_housing_rules", _fair_housing),
    Check("structure", _structure),
    Check("uncertainty_stated", _uncertainty),
    Check("case_mentions", _mentions),
]

TEMPLATE_REPORTS = EvalSuite(
    name="listing_prep-template-reports",
    prompt_version=R.PROMPT_VERSION,
    cases=load_cases(HERE / "report_cases.jsonl"),
    task=_template,
    scorers=TEMPLATE_CHECKS,
    model="template",
)

EVIDENCE_JUDGE = LLMJudge(
    "The output is the narrative of a listing-preparation report for a fictional home, with the"
    " `evidence` (every tool result) it was written from. Score 1-5: 5 = it explains each"
    " recommendation from the evidence (findings, estimates, plans, buyer needs), every figure"
    " matches the evidence, it says plainly where evidence is thin (Low confidence, missing data,"
    " no comparable sales), it makes no promises, and it describes the property and buyer needs"
    " for features, never people or the neighborhood's character; 3 = accurate but mostly restates"
    " figures without reasoning, or misses some gaps; 1 = unsupported claims, wrong figures,"
    " promises, or fair-housing problems.",
    name="evidence_judge",
    output=lambda o: {"narrative": o["narrative"], "evidence": o["evidence"]},
    pass_threshold=0.75,
)

REPORT_AGENT = EvalSuite(
    name="listing_prep-report-agent",
    prompt_version=R.PROMPT_VERSION,
    cases=load_cases(HERE / "report_cases.jsonl"),
    task=_agent,
    scorers=[
        required_tools_called(REQUIRED_TOOLS),
        max_steps(R.BUDGET.max_steps),
        stop_reason("finished"),
        Check("guard_and_review_passed", _guard_passed),
        *TEMPLATE_CHECKS,
        EVIDENCE_JUDGE,
    ],
    max_usd=2.50,
)
