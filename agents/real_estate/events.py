"""§6.5 the national event rail: moments on the time machine's rail, found in code.

Pure. Three families, each with a documented rule (the thresholds are published in
`events.json` under `rules`):

- **Rate turns** (`rate_high` / `rate_low`) on Freddie Mac's weekly 30-yr fixed rate:
  a week is a high (low) when no week within `RATE_WINDOW_WEEKS` on either side is
  higher (lower); ties go to the first week of a plateau; and its topographic
  prominence is at least `RATE_MIN_PROMINENCE_PP` percentage points. Prominence is
  how far the week stands above (below) the higher (lower) of the lowest (highest)
  points on either side before more extreme ground or the series end. The first and
  last weeks are never turns (the series may continue that way), but the window's
  overall high and low are always included when they differ by at least the minimum.
- **Price turns** (`price_yoy_turn_up` / `price_yoy_turn_down`): the national median
  sale price's year-over-year change (value / value 12 months earlier - 1, §5.1)
  crosses zero: the turn month is strictly the new sign, the `TURN_HOLD_BEFORE`
  months before it are never the new sign (and at least one is the old sign), and it
  plus the next `TURN_HOLD_AFTER - 1` months are never the old sign. An exact zero
  (Redfin's rounded national median can repeat a year later) sides with neither, so
  it neither makes nor breaks a turn; a missing month breaks it.
- **Records** (`price_yoy_high` / `price_yoy_low`, `inventory_yoy_high` /
  `inventory_yoy_low`): the window's single highest and lowest national YoY.

Values: rates in percent as published by FRED, YoY as ratios (4 decimals).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from datetime import date
from typing import Any

from agents.real_estate.schema import EventKind, EventsOutput, ExtensionRef, NationalEvent

RATE_MIN_PROMINENCE_PP = 0.5
RATE_WINDOW_WEEKS = 8
TURN_HOLD_BEFORE = 3
TURN_HOLD_AFTER = 3

RULES: dict[str, float] = {
    "rate_min_prominence_pp": RATE_MIN_PROMINENCE_PP,
    "rate_window_weeks": RATE_WINDOW_WEEKS,
    "turn_hold_before_months": TURN_HOLD_BEFORE,
    "turn_hold_after_months": TURN_HOLD_AFTER,
}


def _prominence(values: Sequence[float], i: int) -> float:
    v = values[i]

    def low(step: int) -> float:
        lowest = v
        j = i + step
        while 0 <= j < len(values) and values[j] <= v:
            lowest = min(lowest, values[j])
            j += step
        return lowest

    return v - max(low(-1), low(1))


def peaks(values: Sequence[float], window: int, min_prominence: float) -> list[tuple[int, float]]:
    """(index, prominence) of every local maximum passing the rule (see module doc)."""
    out: list[tuple[int, float]] = []
    for i in range(1, len(values) - 1):
        v = values[i]
        lo, hi = max(0, i - window), min(len(values) - 1, i + window)
        if any(values[j] >= v for j in range(lo, i)) or any(values[j] > v for j in range(i + 1, hi + 1)):
            continue
        p = _prominence(values, i)
        if p >= min_prominence:
            out.append((i, p))
    return out


def rate_turns(
    weekly: Sequence[tuple[date, float]],
    *,
    window: int = RATE_WINDOW_WEEKS,
    min_prominence: float = RATE_MIN_PROMINENCE_PP,
) -> list[NationalEvent]:
    """Highs and lows of the weekly 30-yr rate (oldest first)."""
    if len(weekly) < 3:
        return []
    dates = [d for d, _ in weekly]
    vals = [v for _, v in weekly]
    found: dict[int, tuple[EventKind, float]] = {}
    for i, p in peaks(vals, window, min_prominence):
        found[i] = ("rate_high", p)
    for i, p in peaks([-v for v in vals], window, min_prominence):
        found[i] = ("rate_low", p)
    hi, lo = max(vals), min(vals)
    if hi - lo >= min_prominence:
        found.setdefault(vals.index(hi), ("rate_high", hi - lo))
        found.setdefault(vals.index(lo), ("rate_low", hi - lo))
    return [
        NationalEvent(date=dates[i], kind=kind, metric="mortgage30", value=round(vals[i], 2), prominence=round(p, 2))
        for i, (kind, p) in sorted(found.items())
    ]


def yoy(monthly: Sequence[tuple[date, float | None]]) -> list[tuple[date, float | None]]:
    """§5.1's ratio YoY for each month that has the month 12 earlier (by calendar month)."""
    by_month = {(d.year, d.month): v for d, v in monthly}
    out: list[tuple[date, float | None]] = []
    for d, v in monthly:
        prior = by_month.get((d.year - 1, d.month))
        out.append((d, v / prior - 1 if v is not None and prior else None))
    return out


def _sign(v: float | None) -> int:
    return 0 if v is None or v == 0 else (1 if v > 0 else -1)


def price_turns(
    series: Sequence[tuple[date, float | None]], *, before: int = TURN_HOLD_BEFORE, after: int = TURN_HOLD_AFTER
) -> list[NationalEvent]:
    """Months where the YoY changes sign and the new sign holds (see module doc)."""
    signs = [None if v is None else _sign(v) for _, v in series]
    out: list[NationalEvent] = []
    for i in range(before, len(series) - after + 1):
        new = signs[i]
        if not new:
            continue
        prior, following = signs[i - before : i], signs[i : i + after]
        if None in prior or None in following:
            continue
        if all(s != new for s in prior) and -new in prior and all(s != -new for s in following):
            d, v = series[i]
            out.append(
                NationalEvent(
                    date=d,
                    kind="price_yoy_turn_up" if new > 0 else "price_yoy_turn_down",
                    metric="median_sale_price",
                    value=round(v, 4),  # type: ignore[arg-type]  # nonzero sign => not None
                )
            )
    return out


def records(
    series: Sequence[tuple[date, float | None]], metric: str, high: EventKind, low: EventKind
) -> list[NationalEvent]:
    present = [(d, v) for d, v in series if v is not None]
    if len(present) < 2:
        return []
    top = max(present, key=lambda x: x[1])  # first of ties
    bottom = min(present, key=lambda x: x[1])
    if top[1] == bottom[1]:
        return []
    return [
        NationalEvent(date=top[0], kind=high, metric=metric, value=round(top[1], 4)),  # type: ignore[arg-type]
        NationalEvent(date=bottom[0], kind=low, metric=metric, value=round(bottom[1], 4)),  # type: ignore[arg-type]
    ]


def build_events(
    rates: Iterable[tuple[date, float]],
    national_rows: Iterable[dict[str, Any]],
    since: date,
    through: date,
) -> EventsOutput:
    """`rates`: weekly (date, 30-yr %). `national_rows`: parquet-schema dicts (`period_end`,
    `median_sale_price`, `inventory`), including the 12 months before `since` so YoY
    starts at `since`. Events are kept in [since, through]."""
    weekly = sorted((d, v) for d, v in rates if since <= d <= through)
    rows = sorted((r for r in national_rows if r.get("period_end") is not None), key=lambda r: r["period_end"])
    rows = [r for r in rows if r["period_end"] <= through]

    def window(key: str) -> list[tuple[date, float | None]]:
        return [(d, v) for d, v in yoy([(r["period_end"], r.get(key)) for r in rows]) if d >= since]

    price, inventory = window("median_sale_price"), window("inventory")
    events = [
        *rate_turns(weekly),
        *price_turns(price),
        *records(price, "median_sale_price", "price_yoy_high", "price_yoy_low"),
        *records(inventory, "inventory", "inventory_yoy_high", "inventory_yoy_low"),
    ]
    events.sort(key=lambda e: (e.date, e.kind))
    return EventsOutput(since=since, through=through, rules=dict(RULES), events=events)


def fit(out: EventsOutput, size_of: Callable[[EventsOutput], int], max_bytes: int) -> tuple[EventsOutput | None, list[str]]:
    """Over budget: drop the least prominent rate turns (never the window's high/low
    or the other families) until it fits; if it still can't, publish nothing."""
    warnings: list[str] = []
    events = list(out.events)
    rate_hi = max((e.value for e in events if e.metric == "mortgage30"), default=None)
    rate_lo = min((e.value for e in events if e.metric == "mortgage30"), default=None)
    droppable = sorted(
        (e for e in events if e.metric == "mortgage30" and e.value not in (rate_hi, rate_lo)),
        key=lambda e: e.prominence or 0,
    )
    trimmed = 0
    while size_of(out.model_copy(update={"events": events})) > max_bytes and droppable:
        events.remove(droppable.pop(0))
        trimmed += 1
    fitted = out.model_copy(update={"events": events})
    if size_of(fitted) > max_bytes:
        return None, [f"events.json is {size_of(fitted)} bytes (limit {max_bytes}); not published this run"]
    if trimmed:
        warnings.append(f"events.json over {max_bytes} bytes: dropped the {trimmed} least prominent rate turns")
    return fitted, warnings


def ref(out: EventsOutput) -> ExtensionRef:
    return ExtensionRef(path="events.json", count=len(out.events), through=out.through)
