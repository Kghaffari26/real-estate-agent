"""Deterministic brief checks (SPEC_REAL_ESTATE.md §11), shared by the eval suites
in `evals/real_estate/suites.py`: number fidelity, units, no-advice style, length
and a keyword proxy for flag coverage. Pure functions, no network."""

from __future__ import annotations

import re
from typing import Any

BANNED_PHRASES = ("buy now", "great time to", "will rise", "will fall", "crash", "guaranteed")
MAX_METRO_WORDS = 90
MAX_NATIONAL_SENTENCES = 6

_NUM_RE = re.compile(r"-?\$?\d[\d,]*\.?\d*")


def extract_numbers(text: str) -> list[tuple[float, bool]]:
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


def collect_fact_numbers(facts: dict[str, Any]) -> set[float]:
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
            for value, _pct in extract_numbers(obj):
                nums.add(round(value, 4))
                nums.add(round(abs(value), 4))

    walk(facts)
    return nums


# Numbers that legitimately appear in template text without being a fact
# (e.g. "the 50 largest metros" and "30-year fixed" are fixed phrases, not
# computed figures).
STRUCTURAL_ALLOWLIST = {50.0, 100.0, 30.0, 15.0}


def number_fidelity(
    text: str, facts: dict[str, Any], extra_sources: tuple[Any, ...] = ()
) -> tuple[bool, list[float]]:
    """`extra_sources` covers numbers legitimately drawn from inputs other
    than `facts` itself — e.g. the national brief also narrates `alerts`
    and `mover_counts`, which aren't part of its facts dict."""
    fact_nums = collect_fact_numbers(facts) | STRUCTURAL_ALLOWLIST
    for source in extra_sources:
        fact_nums |= collect_fact_numbers(source)
    unsupported = []
    for value, _pct in extract_numbers(text):
        matched = any(
            abs(value - fn) < 0.05 or abs(round(value, 0) - round(fn, 0)) < 0.5 for fn in fact_nums
        )
        if not matched:
            unsupported.append(value)
    return (len(unsupported) == 0, unsupported)


def units_correctness(text: str, facts: dict[str, Any]) -> tuple[bool, list[float]]:
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
    for value, followed_by_percent in extract_numbers(text):
        rounded = round(abs(value), 4)
        if followed_by_percent and rounded in pp_values and rounded not in other_values:
            violations.append(value)
    return (len(violations) == 0, violations)


def style_check(text: str) -> tuple[bool, list[str]]:
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


def flag_covered(flag_label: str, brief_text: str, key_points: list[str]) -> bool:
    haystack = (brief_text + " " + " ".join(key_points)).lower()
    label_lower = flag_label.lower()
    for phrase, keywords in _FLAG_KEYWORDS.items():
        if phrase in label_lower and any(k in haystack for k in keywords):
            return True
    return False


