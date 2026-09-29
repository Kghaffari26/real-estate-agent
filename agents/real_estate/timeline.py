"""§6.4 timelines: one metric's monthly history for every tracked metro, from
`timeline_since` (2012) to the latest month, for the dashboard's time machine.

Pure: takes the long Redfin frame (the parquet schema) and returns
`timeline/<metric>.json` bodies. Values are Redfin's, only rounded to keep each
file small: prices, counts and days to whole numbers, ratios to 3 decimals, months
of supply to 1 decimal. A month a metro doesn't report is null. No changes are
computed here (the dashboard derives month-over-year from these published levels
exactly as `compute.py` does for the latest month).
"""

from __future__ import annotations

import calendar
from collections.abc import Iterable
from datetime import date
from typing import Any

from agents.real_estate.config import Metro
from agents.real_estate.schema import TimelineOutput, TimelineRef

# Metric → decimals (0 = whole number, published as an int).
TIMELINE_METRICS: dict[str, int] = {
    "median_sale_price": 0,
    "inventory": 0,
    "median_dom": 0,
    "price_drops": 3,
    "months_of_supply": 1,
}


def month_end(d: date) -> date:
    return date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])


def month_axis(since: date, through: date) -> list[date]:
    """Every month end from `since`'s month through `through`'s month, inclusive."""
    out: list[date] = []
    y, m = since.year, since.month
    while (y, m) <= (through.year, through.month):
        out.append(month_end(date(y, m, 1)))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def _round(value: Any, decimals: int) -> int | float | None:
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v != v or v in (float("inf"), float("-inf")):  # NaN / inf
        return None
    return int(round(v)) if decimals == 0 else round(v, decimals)


def build_timelines(
    rows: Iterable[dict[str, Any]],
    metros: list[Metro],
    since: date,
    through: date,
    metrics: dict[str, int] = TIMELINE_METRICS,
) -> dict[str, TimelineOutput]:
    """`rows`: parquet-schema dicts (`region`, `period_end`, metric columns)."""
    axis = month_axis(since, through)
    position = {d: i for i, d in enumerate(axis)}
    slug_of = {m.redfin_region: m.slug for m in metros}
    values: dict[str, dict[str, list[int | float | None]]] = {
        key: {m.slug: [None] * len(axis) for m in metros} for key in metrics
    }
    for row in rows:
        slug = slug_of.get(row.get("region"))
        end = row.get("period_end")
        if slug is None or end is None:
            continue
        i = position.get(month_end(end))
        if i is None:
            continue
        for key, decimals in metrics.items():
            values[key][slug][i] = _round(row.get(key), decimals)
    return {key: TimelineOutput(metric=key, dates=axis, metros=values[key]) for key in metrics}


def fit(
    timelines: dict[str, TimelineOutput], size_of: Any, max_bytes: int
) -> tuple[dict[str, TimelineOutput], list[str]]:
    """Drop (with a warning) any timeline over the per-file budget; never trims history."""
    kept: dict[str, TimelineOutput] = {}
    warnings: list[str] = []
    for key, tl in timelines.items():
        size = size_of(tl)
        if size > max_bytes:
            warnings.append(f"timeline/{key}.json is {size} bytes (limit {max_bytes}); not published this run")
        else:
            kept[key] = tl
    return kept, warnings


def refs(timelines: dict[str, TimelineOutput]) -> list[TimelineRef]:
    return [
        TimelineRef(metric=key, path=f"timeline/{key}.json", start=tl.dates[0], end=tl.dates[-1], months=len(tl.dates))
        for key, tl in timelines.items()
        if tl.dates
    ]
