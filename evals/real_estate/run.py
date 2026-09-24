"""Evals for the real estate agent's briefs (SPEC_REAL_ESTATE.md §11).

Runs entirely offline against `evals/real_estate/fixtures.py` — no
network or LLM calls. Evaluates whatever `analyze.generate_metro_brief`/
`generate_national_brief` currently produce; today that's always the
deterministic templates (`narrative_source: "template"`, see
STATUS.md — the LLM path isn't wired up yet), but nothing here assumes
which one it is.

The spec's "Flag coverage" eval calls for a fast-tier LLM judge; since no
LLM is wired up (and evals must stay free/offline per this session's cost
rules), that check is a keyword-based substitute here and is reported
honestly as a lower-confidence proxy, not a drop-in replacement.

    uv run python -m evals.real_estate.run
"""

from __future__ import annotations

import json
import re
import sys
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))  # run as a plain script

from agents.real_estate import analyze  # noqa: E402
from evals.real_estate import fixtures  # noqa: E402

RESULTS_DIR = Path("evals/results")
BANNED_PHRASES = ("buy now", "great time to", "will rise", "will fall", "crash", "guaranteed")
MAX_METRO_WORDS = 90
MAX_NATIONAL_SENTENCES = 6

_NUM_RE = re.compile(r"-?\$?\d[\d,]*\.?\d*")


def _extract_numbers(text: str) -> list[tuple[float, bool]]:
    """Returns `(value, followed_by_percent)` for every number-looking token."""
    out = []
    for m in _NUM_RE.finditer(text):
        token = m.group().replace("$", "").replace(",", "")
        if token in ("", "-", "."):
            continue
        try:
            value = float(token)
        except ValueError:
            continue
        end = m.end()
        followed_by_percent = end < len(text) and text[end] == "%"
        out.append((value, followed_by_percent))
    return out


def _collect_fact_numbers(facts: dict[str, Any]) -> set[float]:
    nums: set[float] = set()

    def walk(obj: Any) -> None:
        if isinstance(obj, dict):
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for v in obj:
                walk(v)
        elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
            nums.add(round(float(obj), 4))
            nums.add(round(abs(float(obj)), 4))
        elif isinstance(obj, str):
            # e.g. "August 2026" embeds a legitimate non-computed year.
            for value, _pct in _extract_numbers(obj):
                nums.add(round(value, 4))
                nums.add(round(abs(value), 4))

    walk(facts)
    return nums


# Numbers that legitimately appear in template text without being a fact
# (e.g. "the 50 largest metros" and "30-year fixed" are fixed phrases, not
# computed figures).
STRUCTURAL_ALLOWLIST = {50.0, 100.0, 30.0, 15.0}


def _number_fidelity(
    text: str, facts: dict[str, Any], extra_sources: tuple[Any, ...] = ()
) -> tuple[bool, list[float]]:
    """`extra_sources` covers numbers legitimately drawn from inputs other
    than `facts` itself — e.g. the national brief also narrates `alerts`
    and `mover_counts`, which aren't part of its facts dict."""
    fact_nums = _collect_fact_numbers(facts) | STRUCTURAL_ALLOWLIST
    for source in extra_sources:
        fact_nums |= _collect_fact_numbers(source)
    unsupported = []
    for value, _pct in _extract_numbers(text):
        matched = any(
            abs(value - fn) < 0.05 or abs(round(value, 0) - round(fn, 0)) < 0.5 for fn in fact_nums
        )
        if not matched:
            unsupported.append(value)
    return (len(unsupported) == 0, unsupported)


def _units_correctness(text: str, facts: dict[str, Any]) -> tuple[bool, list[float]]:
    """No number that's a `_yoy_pp`/`yoy_pp`-labeled fact should be immediately
    followed by "%" in the text (it should read "pp", not "%"). A value that
    also legitimately occurs as a non-pp fact (e.g. two metrics coincidentally
    sharing 0.1) is not flagged — this is a coarse, provenance-free heuristic,
    not a real per-token guard.
    """
    pp_values, other_values = set(), set()
    for metric in facts.get("metrics", {}).values():
        if not isinstance(metric, dict):
            continue
        for key, val in metric.items():
            if not isinstance(val, (int, float)):
                continue
            (pp_values if key.endswith("_pp") else other_values).add(round(abs(float(val)), 4))

    violations = []
    for value, followed_by_percent in _extract_numbers(text):
        rounded = round(abs(value), 4)
        if followed_by_percent and rounded in pp_values and rounded not in other_values:
            violations.append(value)
    return (len(violations) == 0, violations)


def _style_check(text: str) -> tuple[bool, list[str]]:
    lowered = text.lower()
    hits = [p for p in BANNED_PHRASES if p in lowered]
    return (len(hits) == 0, hits)


_FLAG_KEYWORDS: dict[str, tuple[str, ...]] = {
    "seller's market": ("seller",),
    "buyer's market": ("buyer",),
    "36-month high": ("36-month", "hot", "warm"),
    "price cuts": ("price cut", "price drop"),
    "outpacing": ("outpac", "rent"),
    "payment": ("payment",),
    "median price": ("price",),
    "inventory": ("inventory",),
    "days on market": ("day",),
}


def _flag_covered(flag_label: str, brief_text: str, key_points: list[str]) -> bool:
    haystack = (brief_text + " " + " ".join(key_points)).lower()
    label_lower = flag_label.lower()
    for phrase, keywords in _FLAG_KEYWORDS.items():
        if phrase in label_lower and any(k in haystack for k in keywords):
            return True
    return False


def run_metro_evals() -> dict[str, Any]:
    results = []
    for facts in fixtures.METRO_FACTS:
        brief = analyze.generate_metro_brief(facts, reused=False)
        fidelity_ok, unsupported = _number_fidelity(brief.text, facts)
        units_ok, unit_violations = _units_correctness(brief.text, facts)
        style_ok, banned_hits = _style_check(brief.text)
        word_count = len(brief.text.split())
        length_ok = word_count <= MAX_METRO_WORDS
        flags = facts.get("flags", [])
        covered = [f for f in flags if _flag_covered(f, brief.text, brief.key_points)]
        flag_coverage = (len(covered) / len(flags)) if flags else 1.0

        results.append(
            {
                "metro": facts["metro"],
                "text": brief.text,
                "word_count": word_count,
                "number_fidelity_pass": fidelity_ok,
                "unsupported_numbers": unsupported,
                "units_correct": units_ok,
                "unit_violations": unit_violations,
                "style_pass": style_ok,
                "banned_phrase_hits": banned_hits,
                "length_pass": length_ok,
                "flags_total": len(flags),
                "flags_covered": len(covered),
                "flag_coverage_pct": round(flag_coverage * 100, 1),
            }
        )
    return {"metro_results": results}


def run_national_evals() -> dict[str, Any]:
    results = []
    for facts, alerts, counts in zip(
        fixtures.NATIONAL_FACTS, fixtures.NATIONAL_ALERTS, fixtures.NATIONAL_MOVER_COUNTS, strict=True
    ):
        brief = analyze.generate_national_brief(facts, alerts, counts)
        derived = {"alert_metro_counts": [len(a.get("slugs", [])) for a in alerts]}
        fidelity_ok, unsupported = _number_fidelity(brief.text, facts, extra_sources=(alerts, counts, derived))
        sentence_count = len([s for s in re.split(r"(?<=[.!?])\s+", brief.text.strip()) if s])
        length_ok = sentence_count <= MAX_NATIONAL_SENTENCES

        top2 = alerts[:2]
        covered = sum(1 for a in top2 if _flag_covered(a["label"], brief.text, brief.key_points))

        results.append(
            {
                "text": brief.text,
                "sentence_count": sentence_count,
                "number_fidelity_pass": fidelity_ok,
                "unsupported_numbers": unsupported,
                "length_pass": length_ok,
                "top2_alerts_covered": covered,
                "top2_alerts_total": len(top2),
            }
        )
    return {"national_results": results}


def summarize(metro: dict[str, Any], national: dict[str, Any]) -> dict[str, Any]:
    metro_results = metro["metro_results"]
    n = len(metro_results)
    fidelity_pass_rate = sum(r["number_fidelity_pass"] for r in metro_results) / n
    units_pass_rate = sum(r["units_correct"] for r in metro_results) / n
    style_pass_rate = sum(r["style_pass"] for r in metro_results) / n
    length_pass_rate = sum(r["length_pass"] for r in metro_results) / n
    avg_flag_coverage = sum(r["flag_coverage_pct"] for r in metro_results) / n

    national_results = national["national_results"]
    nat_fidelity_rate = sum(r["number_fidelity_pass"] for r in national_results) / len(national_results)
    nat_length_rate = sum(r["length_pass"] for r in national_results) / len(national_results)

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "fixture_count": n,
        "number_fidelity": {
            "pass_rate": round(fidelity_pass_rate, 3),
            "target": "100% (spec: 100% of final briefs, first-attempt >= 90%)",
            "meets_target": fidelity_pass_rate == 1.0,
        },
        "units_correctness": {"pass_rate": round(units_pass_rate, 3), "meets_target": units_pass_rate == 1.0},
        "no_advice_style": {"pass_rate": round(style_pass_rate, 3), "meets_target": style_pass_rate == 1.0},
        "length": {"pass_rate": round(length_pass_rate, 3), "meets_target": length_pass_rate == 1.0},
        "flag_coverage": {
            "avg_pct": round(avg_flag_coverage, 1),
            "target": ">= 90% (spec: LLM judge; keyword-based proxy here, see module docstring)",
            "meets_target": avg_flag_coverage >= 90.0,
            "note": "Templates only narrate price/inventory/DOM/temperature, not every flag type — "
            "gaps here point at template coverage, not necessarily a defect.",
        },
        "national_number_fidelity": {"pass_rate": round(nat_fidelity_rate, 3), "meets_target": nat_fidelity_rate == 1.0},
        "national_length": {"pass_rate": round(nat_length_rate, 3), "meets_target": nat_length_rate == 1.0},
    }


def main() -> int:
    metro = run_metro_evals()
    national = run_national_evals()
    summary = summarize(metro, national)

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RESULTS_DIR / f"real_estate-{date.today().isoformat()}.json"
    out_path.write_text(json.dumps({"summary": summary, **metro, **national}, indent=2))

    print(json.dumps(summary, indent=2))
    print(f"\nFull results: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
