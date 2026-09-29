"""§6.6 the weekly pulse: the last `weeks` rolling 4-week windows for every tracked
metro, from Redfin's weekly metro file, plus each metric's year-over-year change.

Pure. Values are Redfin's (not seasonally adjusted, like the monthly pipeline),
rounded to whole numbers. YoY is computed here, never copied from Redfin's YoY
columns: the latest window's value / the value of the window ending exactly 52
weeks (364 days) earlier - 1, or null when either is missing.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import date, timedelta
from typing import Any

from agents.real_estate.config import Metro
from agents.real_estate.schema import ExtensionRef, PulseOutput

WINDOW_WEEKS = 4
# Output key -> Redfin weekly column (NSA, as the monthly pipeline uses).
PULSE_COLUMNS: dict[str, str] = {
    "median_sale_price": "MEDIAN SALE PRICE NSA ($)",
    "new_listings": "NEW LISTINGS NSA",
    "pending_sales": "PENDING SALES NSA",
    "active_listings": "ACTIVE LISTINGS NSA",
}
YEAR = timedelta(days=364)


def _int(v: Any) -> int | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else int(round(f))


def build_pulse(rows: Iterable[dict[str, Any]], metros: list[Metro], weeks: int = 12) -> PulseOutput | None:
    """`rows`: dicts with `region`, `period_end` (date) and the `PULSE_COLUMNS` keys."""
    slug_of = {m.redfin_region: m.slug for m in metros}
    by: dict[tuple[str, date], dict[str, Any]] = {}
    for row in rows:
        slug, end = slug_of.get(row.get("region")), row.get("period_end")
        if slug is not None and end is not None:
            by[(slug, end)] = row
    if not by:
        return None
    axis = sorted({end for _, end in by})[-weeks:]
    metros_out: dict[str, dict[str, list[int | None]]] = {}
    yoy_out: dict[str, dict[str, float | None]] = {}
    latest = axis[-1]
    for m in metros:
        if not any((m.slug, d) in by for d in axis):
            continue
        metros_out[m.slug] = {k: [_int(by.get((m.slug, d), {}).get(k)) for d in axis] for k in PULSE_COLUMNS}
        now, then = by.get((m.slug, latest), {}), by.get((m.slug, latest - YEAR), {})
        yoy_out[m.slug] = {}
        for k in PULSE_COLUMNS:
            a, b = _int(now.get(k)), _int(then.get(k))
            yoy_out[m.slug][k] = round(a / b - 1, 4) if a is not None and b else None
    return PulseOutput(window_weeks=WINDOW_WEEKS, weeks=axis, metros=metros_out, yoy=yoy_out)


def fit(out: PulseOutput, size_of: Callable[[PulseOutput], int], max_bytes: int) -> tuple[PulseOutput | None, list[str]]:
    size = size_of(out)
    if size > max_bytes:
        return None, [f"pulse.json is {size} bytes (limit {max_bytes}); not published this run"]
    return out, []


def ref(out: PulseOutput) -> ExtensionRef:
    return ExtensionRef(path="pulse.json", count=len(out.metros), through=out.weeks[-1])
