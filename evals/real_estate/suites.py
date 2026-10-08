"""The real estate agent's eval suites, on `agents_core.evals` (SPEC_REAL_ESTATE.md §11).

    uv run agents-evals run evals.real_estate.suites:TEMPLATE_BRIEFS      # free, offline
    uv run agents-evals run evals.real_estate.suites:LLM_BRIEFS           # ~$0.02
    uv run agents-evals run evals.real_estate.suites:INVESTIGATOR         # ~$0.15
    uv run agents-evals compare --threshold 0.10

Each run appends a line to `evals/history.jsonl` (prompt version, git SHA, model,
scores, pass rate, cost) and writes `evals/results/<date>.json`; the PR workflow
(`.github/workflows/evals.yml`) runs all three and fails on a regression.

- `TEMPLATE_BRIEFS`: the deterministic template briefs every LLM brief falls back
  to, on the 12 metro + 2 national fixtures in `fixtures.py`. The original suite,
  ported: number fidelity, units, no-advice style, length, flag coverage (keyword
  proxy). No LLM calls.
- `LLM_BRIEFS`: the fast-tier metro brief prompt on the same 12 metros, through the
  production guard + template fallback. Adds a first-try guard pass rate and an LLM
  judge for flag coverage (the check §11 specifies).
- `INVESTIGATOR`: trajectory evals for the metro investigator (§6.3) on 6 fixture
  metros snapshotted from live data (`investigator_world.json`, built by
  `scripts/build_investigator_fixtures.py`): required tools, forbidden tools, max
  steps, stop reason, guard pass, sentence count, citing the trigger metric, and an
  LLM-judge quality score against the evidence the tools returned.
"""

from __future__ import annotations

import os
import re
from functools import cache
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
    forbidden_tools_not_called,
    load_cases,
    max_steps,
    required_tools_called,
    stop_reason,
)

from agents.real_estate import analyze, investigate
from evals.real_estate import checks, fixtures

HERE = Path(__file__).resolve().parent
# The prompt is unchanged since 2026-09-26; 2026-10-08 adds no_multiples to the brief guard.
BRIEF_PROMPT_VERSION = "metro-brief-2026-10-08"
SAVE_TRAJECTORIES = os.environ.get("RE_SAVE_TRAJECTORIES")  # a dir: write each loop's trajectory


class Check(Scorer):
    """A pass/fail scorer from a plain function `(case, output) -> (passed, detail)`."""

    def __init__(self, name: str, fn: Any) -> None:
        self.name, self.fn = name, fn

    def score(self, case: EvalCase, out: EvalOutput, ctx: EvalContext) -> Score:
        passed, detail = self.fn(case, out.output)
        return self._result(1.0 if passed else 0.0, bool(passed), str(detail))


class Ratio(Scorer):
    """A scorer from `(case, output) -> (value in 0..1, detail)`, passing at `threshold`."""

    def __init__(self, name: str, fn: Any, threshold: float = 1.0) -> None:
        self.name, self.fn, self.threshold = name, fn, threshold

    def score(self, case: EvalCase, out: EvalOutput, ctx: EvalContext) -> Score:
        value, detail = self.fn(case, out.output)
        return self._result(value, value >= self.threshold, str(detail))


# ---- briefs -----------------------------------------------------------------------


def _brief_cases() -> list[EvalCase]:
    cases = [
        EvalCase(id=f"metro-{i:02d}", input={"kind": "metro", "facts": f}, tags=["metro"])
        for i, f in enumerate(fixtures.METRO_FACTS, 1)
    ]
    for i, (facts, alerts, counts) in enumerate(
        zip(fixtures.NATIONAL_FACTS, fixtures.NATIONAL_ALERTS, fixtures.NATIONAL_MOVER_COUNTS, strict=True), 1
    ):
        cases.append(
            EvalCase(
                id=f"national-{i}",
                input={"kind": "national", "facts": facts, "alerts": alerts, "counts": counts},
                tags=["national"],
            )
        )
    return cases


def _template_brief(case: EvalCase, ectx: EvalContext) -> dict[str, Any]:
    i = case.input
    if i["kind"] == "metro":
        brief = analyze.generate_metro_brief(i["facts"], reused=False)
    else:
        brief = analyze.generate_national_brief(i["facts"], i["alerts"], i["counts"])
    return {"text": brief.text, "key_points": brief.key_points, "narrative_source": brief.narrative_source}


def _fidelity(case: EvalCase, out: dict[str, Any]) -> tuple[bool, Any]:
    i = case.input
    extra: tuple[Any, ...] = ()
    if i["kind"] == "national":
        extra = (i["alerts"], i["counts"], {"alert_metro_counts": [len(a.get("slugs", [])) for a in i["alerts"]]})
    ok, unsupported = checks.number_fidelity(out["text"], i["facts"], extra_sources=extra)
    return ok, unsupported


def _units(case: EvalCase, out: dict[str, Any]) -> tuple[bool, Any]:
    return checks.units_correctness(out["text"], case.input["facts"])


def _style(case: EvalCase, out: dict[str, Any]) -> tuple[bool, Any]:
    return checks.style_check(out["text"] + " " + " ".join(out["key_points"]))


def _length(case: EvalCase, out: dict[str, Any]) -> tuple[bool, Any]:
    if case.input["kind"] == "metro":
        words = len(out["text"].split())
        return words <= checks.MAX_METRO_WORDS, f"{words} words"
    sentences = len([s for s in re.split(r"(?<=[.!?])\s+", out["text"].strip()) if s])
    return sentences <= checks.MAX_NATIONAL_SENTENCES, f"{sentences} sentences"


def _flag_coverage(case: EvalCase, out: dict[str, Any]) -> tuple[float, Any]:
    i = case.input
    labels = i["facts"].get("flags", []) if i["kind"] == "metro" else [a["label"] for a in i["alerts"][:2]]
    if not labels:
        return 1.0, "no flags"
    covered = [f for f in labels if checks.flag_covered(f, out["text"], out["key_points"])]
    return len(covered) / len(labels), f"{len(covered)}/{len(labels)} covered"


BRIEF_CHECKS: list[Scorer] = [
    Check("number_fidelity", _fidelity),
    Check("units", _units),
    Check("no_advice_style", _style),
    Check("length", _length),
    Ratio("flag_coverage_keyword", _flag_coverage, threshold=0.5),
]

TEMPLATE_BRIEFS = EvalSuite(
    name="real_estate-template-briefs",
    prompt_version="templates-2026-09-26",
    cases=_brief_cases(),
    task=_template_brief,
    scorers=BRIEF_CHECKS,
    model="template",
)


def _llm_brief(case: EvalCase, ectx: EvalContext) -> dict[str, Any]:
    facts = case.input["facts"]
    guarded = analyze._structured_or_template(
        ectx.llm,
        "fast",
        analyze.metro_prompt(facts),
        system=analyze.METRO_SYSTEM,
        max_tokens=analyze.METRO_MAX_TOKENS,
        purpose=f"eval_metro_brief:{case.id}",
        guard=analyze.brief_guard(analyze.metro_cache_facts(facts)),
        fallback=lambda: analyze.template_metro_draft(facts),
    )
    return {
        "text": guarded.value.text,
        "key_points": guarded.value.key_points,
        "narrative_source": guarded.narrative_source,
        "attempts": guarded.attempts,
        "flags": facts.get("flags", []),
    }


def _guard_first_try(case: EvalCase, out: dict[str, Any]) -> tuple[bool, Any]:
    return out["narrative_source"] == "llm" and out["attempts"] == 1, (
        f"{out['narrative_source']} after {out['attempts']} attempt(s)"
    )


FLAG_JUDGE = LLMJudge(
    "The output is a short housing-market brief for the metro in the input. Score 5 if it"
    " mentions every entry of the input's `facts.flags` (in any wording), 3 if it mentions"
    " about half, 1 if none. If `facts.flags` is empty, score 5. Ignore style.",
    name="flag_coverage_judge",
    output=lambda o: {"text": o["text"], "key_points": o["key_points"]},
    pass_threshold=0.75,
)

LLM_BRIEFS = EvalSuite(
    name="real_estate-llm-briefs",
    prompt_version=BRIEF_PROMPT_VERSION,
    cases=[c for c in _brief_cases() if c.input["kind"] == "metro"],
    task=_llm_brief,
    scorers=[*BRIEF_CHECKS, Check("guard_first_try", _guard_first_try), FLAG_JUDGE],
)


# ---- the investigator --------------------------------------------------------------


@cache
def investigator_world() -> investigate.World:
    return investigate.World.model_validate_json((HERE / "investigator_world.json").read_text())


def _target(case: EvalCase) -> tuple[investigate.World, investigate.Target]:
    i = case.input
    world = investigator_world()
    if i.get("drop_rates"):
        world = world.model_copy(update={"mortgage30": [None] * len(world.mortgage30)})
    target = investigate.Target(
        slug=i["slug"],
        name=i["name"],
        trigger=i["trigger"],
        trigger_flag=i.get("trigger_flag"),
        trigger_label=i["trigger_label"],
        trigger_metric=i["trigger_metric"],
    )
    return world, target


def _investigate(case: EvalCase, ectx: EvalContext) -> EvalOutput:
    world, target = _target(case)
    loop, box = investigate.build_loop(ectx.llm, world, target)
    result: LoopResult[investigate.InvestigationDraft] = loop.run(investigate.task_prompt(target, world))
    if SAVE_TRAJECTORIES:
        result.trajectory.save(Path(SAVE_TRAJECTORIES) / f"{case.id}.json")
    draft = result.result if result.ok and result.result else investigate.template_investigation(world, target)
    source = (result.narrative_source or "llm") if result.ok else "template"
    output = {
        "explanation": draft.explanation,
        "cited_metrics": list(draft.cited_metrics),
        "narrative_source": source,
        "evidence": box.seen,  # everything the tools returned, for the judge
    }
    return EvalOutput(output, loop=result)


class CaseForbiddenTools(Scorer):
    """`forbidden_tools_not_called` with the list from each case's `expected`."""

    name = "forbidden_tools_not_called"

    def score(self, case: EvalCase, out: EvalOutput, ctx: EvalContext) -> Score:
        return forbidden_tools_not_called(case.expected.get("forbidden_tools", [])).score(case, out, ctx)


def _guard_passed(case: EvalCase, out: dict[str, Any]) -> tuple[bool, Any]:
    return out["narrative_source"] == "llm", out["narrative_source"]


def _sentences(case: EvalCase, out: dict[str, Any]) -> tuple[bool, Any]:
    n = investigate.count_sentences(out["explanation"])
    return investigate.MIN_SENTENCES <= n <= investigate.MAX_SENTENCES, f"{n} sentences"


def _cites_trigger(case: EvalCase, out: dict[str, Any]) -> tuple[bool, Any]:
    return case.expected["trigger_metric"] in out["cited_metrics"], out["cited_metrics"]


QUALITY_JUDGE = LLMJudge(
    "The input names a U.S. metro and why it's being investigated. The output has a 4-6"
    " sentence `explanation` of why this is happening, the metrics it cites, and the"
    " `evidence` (tool results) it was written from. Score 1-5 for quality: 5 = it explains"
    " plausible drivers (supply vs. demand, local vs. regional vs. national, rates) that the"
    " evidence actually supports, every figure matches the evidence, it says when the data"
    " can't tell, and it has no predictions or advice; 3 = accurate but mostly restates"
    " numbers without explaining; 1 = unsupported claims, wrong figures, predictions or advice.",
    name="quality_judge",
    pass_threshold=0.75,
)

INVESTIGATOR = EvalSuite(
    name="real_estate-investigator",
    prompt_version=investigate.PROMPT_VERSION,
    cases=load_cases(HERE / "investigator_cases.jsonl"),
    task=_investigate,
    scorers=[
        required_tools_called(["get_metro_series", "compare_to_peers"]),
        CaseForbiddenTools(),
        max_steps(investigate.BUDGET.max_steps),
        stop_reason("finished"),
        Check("guard_passed", _guard_passed),
        Check("sentences_4_to_6", _sentences),
        Check("cites_trigger_metric", _cites_trigger),
        QUALITY_JUDGE,
    ],
)
