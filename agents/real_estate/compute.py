"""Per-metric computations from a metro's (or the nation's) monthly time
series: latest value, YoY/MoM changes (respecting each metric's
`change_kind`), 3-month trend, 36-month highs/lows, percentile ranks, and
the affordability calculator (SPEC_REAL_ESTATE.md §5.1-§5.2).

Permits get a rolling 12-month sum before any of this, because monthly
permits are noisy — that's `rolling_12m`/`compute_permits`, kept separate
from `compute_metric_series` since their output shape differs (`yoy_12m`,
not `yoy`/`mom`/`trend_3m`).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta


def _month_index(d: date) -> int:
    return d.year * 12 + d.month


@dataclass
class MetricChange:
    value: float | None
    yoy: float | None = None
    mom: float | None = None
    trend_3m: str | None = None
    high_36m: bool | None = None
    low_36m: bool | None = None
    pct_rank: float | None = None
    yoy_pct_rank: float | None = None

    def to_dict(self) -> dict[str, object]:
        d: dict[str, object] = {"value": self.value}
        for attr in ("yoy", "mom", "trend_3m", "high_36m", "low_36m", "pct_rank", "yoy_pct_rank"):
            val = getattr(self, attr)
            if val is not None:
                d[attr] = val
        return d


def _change(value_t: float, value_prior: float | None, change_kind: str) -> float | None:
    if value_prior is None:
        return None
    if change_kind == "ratio":
        if value_prior == 0:
            return None
        return value_t / value_prior - 1
    # "pp" (shares stored as ratios 0-1) and "diff" (already native units,
    # e.g. days, months) both reduce to a plain difference.
    return value_t - value_prior


def _trend_3m(series: list[float | None]) -> str | None:
    """`series` is up to 3 consecutive monthly values, oldest first. Flat if
    the relative change across the window is under 0.5%."""
    vals = [v for v in series if v is not None]
    if len(vals) < 2:
        return None
    first, last = vals[0], vals[-1]
    if first == 0:
        if last == 0:
            return "flat"
        return "up" if last > 0 else "down"
    rel = (last - first) / abs(first)
    if abs(rel) < 0.005:
        return "flat"
    return "up" if rel > 0 else "down"


def compute_metric_series(
    months_series: list[tuple[date, float | None]],
    change_kind: str,
    as_of: date | None = None,
    history_months: int = 36,
) -> MetricChange:
    """`months_series` is a metro's (period_end, value) pairs for one metric,
    in any order, at most one row per month. Returns the latest value's
    changes and 36-month high/low, matched by calendar month (not position),
    so a gap in the data never silently shifts what counts as "a year ago".
    """
    by_month = {_month_index(d): v for d, v in months_series if v is not None}
    if not by_month:
        return MetricChange(value=None)

    latest_month = max(by_month) if as_of is None else _month_index(as_of)
    if latest_month not in by_month:
        return MetricChange(value=None)
    value_t = by_month[latest_month]

    mom = _change(value_t, by_month.get(latest_month - 1), change_kind)
    yoy = _change(value_t, by_month.get(latest_month - 12), change_kind)
    trend_3m = _trend_3m([by_month.get(latest_month - i) for i in (2, 1, 0)])

    window = [v for m, v in by_month.items() if latest_month - (history_months - 1) <= m <= latest_month]
    high_36m = bool(window) and value_t >= max(window)
    low_36m = bool(window) and value_t <= min(window)

    return MetricChange(value=value_t, mom=mom, yoy=yoy, trend_3m=trend_3m, high_36m=high_36m, low_36m=low_36m)


def value_at_offset(
    months_series: list[tuple[date, float | None]], offset: int, as_of: date | None = None
) -> float | None:
    """The raw value `offset` months before the latest (or `as_of`) month —
    used where a caller needs the actual prior value rather than a change
    (e.g. detecting a months-of-supply threshold crossing)."""
    by_month = {_month_index(d): v for d, v in months_series if v is not None}
    if not by_month:
        return None
    latest_month = max(by_month) if as_of is None else _month_index(as_of)
    return by_month.get(latest_month - offset)


def add_percentile_ranks(changes_by_slug: dict[str, MetricChange]) -> None:
    """Mutates `changes_by_slug` in place: `pct_rank` (of `value`) and
    `yoy_pct_rank` (of `yoy`), each the fraction of *other tracked metros*
    (with a non-null value for this metric) at or below this one."""
    _assign_pct_rank(changes_by_slug, "value", "pct_rank")
    _assign_pct_rank(changes_by_slug, "yoy", "yoy_pct_rank")


def _assign_pct_rank(changes_by_slug: dict[str, MetricChange], attr: str, out_attr: str) -> None:
    pairs = [(slug, getattr(c, attr)) for slug, c in changes_by_slug.items() if getattr(c, attr) is not None]
    n = len(pairs)
    if n < 2:
        return
    ordered = sorted(pairs, key=lambda p: p[1])
    for rank, (slug, _val) in enumerate(ordered):
        setattr(changes_by_slug[slug], out_attr, round(rank / (n - 1), 4))


def series_for_dates(months_series: list[tuple[date, float | None]], dates: list[date]) -> list[float | None]:
    """Align a metro's series to a shared `dates` array (one series per
    published file, per SPEC §6's "all series share one dates array" rule)."""
    by_date = dict(months_series)
    return [by_date.get(d) for d in dates]


def trailing_sum(months_series: list[tuple[date, float | None]], months: int = 12, as_of: date | None = None) -> float | None:
    """Sum of whatever values are present in the trailing `months` months
    (unlike `rolling_12m`, doesn't require every month to be present)."""
    by_month = {_month_index(d): v for d, v in months_series if v is not None}
    if not by_month:
        return None
    latest_month = max(by_month) if as_of is None else _month_index(as_of)
    vals = [v for m, v in by_month.items() if latest_month - (months - 1) <= m <= latest_month]
    return sum(vals) if vals else None


def month_end_dates(anchor: date, months: int) -> list[date]:
    """`months` consecutive month-end dates ending at the month containing
    `anchor`, oldest first."""
    dates: list[date] = []
    for i in range(months):
        total = anchor.year * 12 + (anchor.month - 1) - i
        yy, mm = divmod(total, 12)
        mm += 1  # divmod gives a 0-based month
        next_month = date(yy + 1, 1, 1) if mm == 12 else date(yy, mm + 1, 1)
        dates.append(next_month - timedelta(days=1))
    dates.reverse()
    return dates


# -- permits: rolling 12-month sums (§5.1) -------------------------------


def rolling_12m(months_series: list[tuple[date, float | None]]) -> dict[int, float]:
    """Returns `{month_index: rolling 12-month sum ending at that month}`,
    computed only for months where all 12 trailing months are present."""
    by_month = {_month_index(d): v for d, v in months_series if v is not None}
    out: dict[int, float] = {}
    for m in by_month:
        window = [by_month.get(m - i) for i in range(12)]
        if all(w is not None for w in window):
            out[m] = sum(window)  # type: ignore[arg-type]
    return out


def compute_permits(
    months_series: list[tuple[date, float | None]], as_of: date | None = None
) -> dict[str, float | None]:
    rolled = rolling_12m(months_series)
    if not rolled:
        return {"value": None, "yoy_12m": None}
    latest_month = max(rolled) if as_of is None else _month_index(as_of)
    if latest_month not in rolled:
        return {"value": None, "yoy_12m": None}
    value_t = rolled[latest_month]
    prior = rolled.get(latest_month - 12)
    yoy_12m = (value_t / prior - 1) if prior else None
    return {"value": value_t, "yoy_12m": yoy_12m}


# -- affordability (§5.2) ------------------------------------------------


def amortized_payment(principal: float, annual_rate_pct: float, term_years: int = 30) -> float:
    """Monthly P&I: `M = P*r(1+r)^n / ((1+r)^n - 1)`."""
    r = annual_rate_pct / 100 / 12
    n = term_years * 12
    if r == 0:
        return principal / n
    factor = (1 + r) ** n
    return principal * r * factor / (factor - 1)


@dataclass
class Affordability:
    payment_now: float
    payment_year_ago: float | None
    payment_change_pct: float | None
    payment_to_income: float | None
    assumptions: dict[str, float | None]
    median_household_income: int | None = None
    income_year: int | None = None


def compute_affordability(
    price_now: float,
    price_year_ago: float | None,
    rate_now: float,
    rate_year_ago: float | None,
    median_household_income: int | None = None,
    income_year: int | None = None,
    down_payment_pct: float = 0.20,
    term_years: int = 30,
) -> Affordability:
    payment_now = amortized_payment(price_now * (1 - down_payment_pct), rate_now, term_years)

    payment_year_ago: float | None = None
    payment_change_pct: float | None = None
    if price_year_ago is not None and rate_year_ago is not None:
        payment_year_ago = amortized_payment(price_year_ago * (1 - down_payment_pct), rate_year_ago, term_years)
        if payment_year_ago:
            payment_change_pct = payment_now / payment_year_ago - 1

    payment_to_income = payment_now * 12 / median_household_income if median_household_income else None

    return Affordability(
        payment_now=round(payment_now, 2),
        payment_year_ago=round(payment_year_ago, 2) if payment_year_ago is not None else None,
        payment_change_pct=payment_change_pct,
        payment_to_income=payment_to_income,
        median_household_income=median_household_income,
        income_year=income_year,
        assumptions={
            "down_payment_pct": down_payment_pct,
            "term_years": term_years,
            "rate_now": rate_now,
            "rate_year_ago": rate_year_ago,
            "price_year_ago": price_year_ago,
        },
    )
