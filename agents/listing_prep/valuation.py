"""Valuation ranges for a property (Listing Prep P3, SPEC_LISTING_PREP.md §5.2, §5.6).

Numbers come from here, never from a model. Two methods:

* **Pre-feed (`zip_ppsf_value`)**, until the MLS feed lands: the ZIP's median sale price
  per square foot (Redfin, published in the region data) × the confirmed square footage,
  adjusted for size and condition, as a deliberately wide range with **Low**
  confidence. It always says so, and that comps will narrow it.
* **Comparable sales (`comp_value`, behind `USE_COMPS`)**, for when MLS closed sales
  exist: select similar recent sales nearby, estimate local adjustments with a small
  ridge regression shrunk toward documented priors, adjust each comp to the subject and
  to today with the ZIP price trend, and report the similarity-weighted interquartile
  range. Confidence comes from the evidence: count, similarity, dispersion.

`backtest` scores the comp engine on closed sales (each sale predicted from the sales
before it), so its coverage and error can be published once the feed is live.

The priors below are documented assumptions, not findings; the report labels anything
resting on them as Low confidence.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

Confidence = Literal["high", "moderate", "low"]

# Off until the CRMLS feed is licensed and loaded (P7); the comp engine is tested now.
USE_COMPS = False

# ---- documented priors -------------------------------------------------------------
# $/sq ft falls as homes get larger: price ∝ sqft^0.7 is a common hedonic elasticity, so
# $/sq ft ∝ sqft^-0.3 against the ZIP's typical size. Capped so a mansion in a ZIP of
# condos doesn't get an absurd adjustment.
SIZE_ELASTICITY = -0.3
SIZE_ADJ_BOUNDS = (0.8, 1.2)
# Each condition point (1-5, confirmed photo findings) away from average (3) moves value
# about 3%, capped at -8%/+6%.
CONDITION_STEP = 0.03
CONDITION_ADJ_BOUNDS = (0.92, 1.06)
# Pre-feed half-widths of the range.
PREFEED_SPREAD = 0.15
PREFEED_SPREAD_THIN = 0.25  # the ZIP is low-sample, or the city stands in for it
ROUND_TO = 5_000
# Ridge priors for log(price) on the comp set (per unit): sq ft as a log elasticity,
# a bedroom +1%, a bathroom +2.5%, a year of age -0.2%, a pool +3%, a garage space +1.5%.
PRIORS = {"log_sqft": 0.7, "beds": 0.01, "baths": 0.025, "age": -0.002, "pool": 0.03, "garage": 0.015}
RIDGE = 4.0  # how strongly the local fit is pulled toward the priors (in "comps' worth")
# Similarity is a product of five factors (size, age, distance, recency, rooms), 1 for an
# identical home next door sold today. Good comps (within a mile and a year, similar size)
# typically score 0.1-0.2, so "high" asks for a mean of at least 0.10.
HIGH_MEAN_SIMILARITY = 0.10
# A range never claims more precision than ±2%, even when the comps agree exactly.
MIN_HALF_WIDTH = 0.02


@dataclass(frozen=True)
class Valuation:
    low: int
    mid: int
    high: int
    method: Literal["zip_ppsf", "comps"]
    confidence: Confidence
    notes: list[str] = field(default_factory=list)
    inputs: dict[str, float | int | str | None] = field(default_factory=dict)


def _round(v: float) -> int:
    return int(round(v / ROUND_TO) * ROUND_TO)


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def condition_score(findings: Iterable[tuple[int, str]]) -> float | None:
    """Mean condition (1-5) of *confirmed or edited* findings, weighting repairs more than
    cosmetics. `findings` are (condition, severity) pairs; None when there are none."""
    weights = {"cosmetic": 1.0, "minor_repair": 1.5, "major_repair": 2.5}
    pairs = [(c, weights.get(s, 1.0)) for c, s in findings]
    total = sum(w for _, w in pairs)
    return sum(c * w for c, w in pairs) / total if total else None


def condition_adjustment(score: float | None) -> float:
    if score is None:
        return 1.0
    return _clamp(1 + CONDITION_STEP * (score - 3), *CONDITION_ADJ_BOUNDS)


def zip_ppsf_value(
    *,
    sqft: int,
    zip_ppsf: float | None,
    zip_median_price: float | None,
    zip_low_sample: bool,
    city_ppsf: float | None = None,
    condition: float | None = None,
) -> Valuation | None:
    """The pre-feed estimate. None when there's no $/sq ft for the ZIP or its city."""
    notes: list[str] = []
    ppsf, source = zip_ppsf, "zip"
    if ppsf is None or zip_low_sample:
        if city_ppsf is None:
            if ppsf is None:
                return None
            notes.append("Few recent sales in this ZIP, so its $/sq ft is noisy.")
        else:
            ppsf, source = city_ppsf, "city"
            notes.append("The ZIP has too few recent sales; the city’s $/sq ft is used instead.")
    assert ppsf is not None
    typical = (zip_median_price / zip_ppsf) if (zip_median_price and zip_ppsf) else None
    size_adj = _clamp((sqft / typical) ** SIZE_ELASTICITY, *SIZE_ADJ_BOUNDS) if typical else 1.0
    cond_adj = condition_adjustment(condition)
    mid = ppsf * sqft * size_adj * cond_adj
    spread = PREFEED_SPREAD_THIN if (source == "city" or zip_low_sample) else PREFEED_SPREAD
    if city_ppsf and zip_ppsf and source == "zip":
        spread += min(abs(zip_ppsf / city_ppsf - 1) / 2, 0.10)  # the ZIP vs its city: more spread, wider range
    notes.append("A wide range from area medians: comparable sales from the MLS feed will narrow it.")
    if condition is None:
        notes.append("No confirmed photo findings yet, so condition isn’t reflected.")
    return Valuation(
        low=_round(mid * (1 - spread)),
        mid=_round(mid),
        high=_round(mid * (1 + spread)),
        method="zip_ppsf",
        confidence="low",
        notes=notes,
        inputs={
            "sqft": sqft,
            "ppsf": round(ppsf, 2),
            "ppsf_source": source,
            "typical_sqft": round(typical) if typical else None,
            "size_adjustment": round(size_adj, 4),
            "condition_score": round(condition, 2) if condition is not None else None,
            "condition_adjustment": round(cond_adj, 4),
            "spread": round(spread, 4),
        },
    )


# ---- comparable sales ----------------------------------------------------------------


@dataclass(frozen=True)
class Home:
    sqft: int
    beds: int
    baths: float
    year_built: int
    property_type: str
    lat: float
    lon: float
    pool: bool = False
    garage: int = 0


@dataclass(frozen=True)
class Sale:
    home: Home
    price: float
    closed: date
    id: str = ""


@dataclass(frozen=True)
class Comp:
    sale: Sale
    miles: float
    similarity: float
    adjusted: float = 0.0


def miles(a: Home, b: Home) -> float:
    r = 3958.8
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dp, dl = p2 - p1, math.radians(b.lon - a.lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _months_between(a: date, b: date) -> float:
    return (b.year - a.year) * 12 + (b.month - a.month) + (b.day - a.day) / 30.0


def select_comps(subject: Home, sales: Iterable[Sale], as_of: date, *, radius: float = 1.0, months: int = 12, min_comps: int = 5, max_comps: int = 15) -> list[Comp]:
    """Same property type, sold before `as_of` within `months`, within `radius` miles
    (widened to 2 then 3 miles if fewer than `min_comps`), size within ±35%; the most
    similar `max_comps`."""
    pool = [s for s in sales if s.home.property_type == subject.property_type and 0 <= _months_between(s.closed, as_of) <= months and 0.65 <= s.home.sqft / subject.sqft <= 1.35]
    for r in (radius, 2.0, 3.0):
        near = [(s, miles(subject, s.home)) for s in pool]
        near = [(s, d) for s, d in near if d <= r]
        if len(near) >= min_comps or r == 3.0:
            break
    comps = []
    for s, d in near:
        size = math.exp(-abs(math.log(s.home.sqft / subject.sqft)) / 0.15)
        age = math.exp(-abs(s.home.year_built - subject.year_built) / 25)
        dist = math.exp(-d / 0.75)
        recency = math.exp(-_months_between(s.closed, as_of) / 9)
        rooms = math.exp(-(abs(s.home.beds - subject.beds) + abs(s.home.baths - subject.baths)) / 3)
        comps.append(Comp(s, d, round(size * age * dist * recency * rooms, 6)))
    comps.sort(key=lambda c: c.similarity, reverse=True)
    return comps[:max_comps]


def _features(h: Home, as_of: date) -> dict[str, float]:
    return {"log_sqft": math.log(h.sqft), "beds": h.beds, "baths": h.baths, "age": as_of.year - h.year_built, "pool": float(h.pool), "garage": float(h.garage)}


def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting (the systems here are at most 7×7)."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[piv] = m[piv], m[col]
        if abs(m[col][col]) < 1e-12:
            continue
        for r in range(n):
            if r != col:
                f = m[r][col] / m[col][col]
                m[r] = [x - f * y for x, y in zip(m[r], m[col], strict=True)]
    return [m[i][n] / m[i][i] if abs(m[i][i]) > 1e-12 else 0.0 for i in range(n)]


def fit_adjustments(comps: Sequence[Comp], as_of: date) -> dict[str, float]:
    """Weighted ridge regression of log(price) on the features, centred, shrunk toward
    PRIORS by RIDGE comps' worth. With few or similar comps it returns ≈ the priors."""
    keys = list(PRIORS)
    rows = [(_features(c.sale.home, as_of), math.log(c.sale.price), c.similarity) for c in comps]
    total = sum(w for _, _, w in rows)
    if total <= 0 or len(rows) < 3:
        return dict(PRIORS)
    mean_x = {k: sum(x[k] * w for x, _, w in rows) / total for k in keys}
    mean_y = sum(y * w for _, y, w in rows) / total
    # (XᵀWX + λ·n̄·D) β = XᵀWy + λ·n̄·D·prior, with D scaling each feature by its variance
    var = {k: max(sum(w * (x[k] - mean_x[k]) ** 2 for x, _, w in rows) / total, 1e-6) for k in keys}
    lam = RIDGE * total / len(rows)
    a = [[sum(w * (x[i] - mean_x[i]) * (x[j] - mean_x[j]) for x, _, w in rows) + (lam * var[i] if i == j else 0.0) for j in keys] for i in keys]
    b = [sum(w * (x[i] - mean_x[i]) * (y - mean_y) for x, y, w in rows) + lam * var[i] * PRIORS[i] for i in keys]
    return dict(zip(keys, _solve(a, b), strict=True))


def _weighted_quantile(values: Sequence[float], weights: Sequence[float], q: float) -> float:
    pairs = sorted(zip(values, weights, strict=True))
    total = sum(w for _, w in pairs)
    acc = 0.0
    for v, w in pairs:
        acc += w
        if acc >= q * total:
            return v
    return pairs[-1][0]


def comp_value(subject: Home, sales: Iterable[Sale], as_of: date, *, price_index: Callable[[date], float | None] | None = None, condition: float | None = None) -> Valuation | None:
    """The comps' similarity-weighted interquartile range, each comp adjusted to the
    subject (fitted coefficients) and to `as_of` (`price_index`: the ZIP's median price
    by month; missing months leave a comp unadjusted for time). None with < 3 comps."""
    comps = select_comps(subject, sales, as_of)
    if len(comps) < 3:
        return None
    beta = fit_adjustments(comps, as_of)
    target = _features(subject, as_of)
    now_idx = price_index(as_of) if price_index else None
    adjusted: list[Comp] = []
    for c in comps:
        f = _features(c.sale.home, as_of)
        log_adj = sum(beta[k] * (target[k] - f[k]) for k in beta)
        then_idx = price_index(c.sale.closed) if price_index else None
        time = (now_idx / then_idx) if (now_idx and then_idx) else 1.0
        adjusted.append(Comp(c.sale, c.miles, c.similarity, c.sale.price * math.exp(log_adj) * time))
    vals = [c.adjusted for c in adjusted]
    w = [c.similarity for c in adjusted]
    cond = condition_adjustment(condition)
    q1, q2, q3 = (_weighted_quantile(vals, w, q) * cond for q in (0.25, 0.5, 0.75))
    q1, q3 = min(q1, q2 * (1 - MIN_HALF_WIDTH)), max(q3, q2 * (1 + MIN_HALF_WIDTH))
    dispersion = (q3 - q1) / q2 if q2 else 1.0  # includes the ±2% floor
    mean_sim = sum(w) / len(w)
    n = len(adjusted)
    confidence: Confidence = "high" if (n >= 8 and mean_sim >= HIGH_MEAN_SIMILARITY and dispersion <= 0.10) else "moderate" if (n >= 5 and dispersion <= 0.18) else "low"
    notes = [f"{n} comparable sales within {max(c.miles for c in adjusted):.1f} miles, adjusted to this home and to today."]
    if confidence == "low":
        notes.append("Few or loosely matched comparables: treat the range as indicative.")
    return Valuation(
        low=_round(q1),
        mid=_round(q2),
        high=_round(q3),
        method="comps",
        confidence=confidence,
        notes=notes,
        inputs={"comps": n, "mean_similarity": round(mean_sim, 3), "dispersion": round(dispersion, 4), **{f"beta_{k}": round(v, 5) for k, v in beta.items()}},
    )


# ---- backtest --------------------------------------------------------------------------


@dataclass(frozen=True)
class BacktestBand:
    band: str
    n: int
    coverage: float  # share of actual prices inside the predicted range
    median_abs_error: float  # median |mid / actual - 1|


BANDS = ((0, 750_000, "under $750K"), (750_000, 1_250_000, "$750K–$1.25M"), (1_250_000, 2_000_000, "$1.25M–$2M"), (2_000_000, math.inf, "$2M and up"))


def backtest(sales: Sequence[Sale], *, price_index: Callable[[date], float | None] | None = None) -> list[BacktestBand]:
    """Predict each sale from the sales that closed before it; score by price band."""
    hits: dict[str, list[tuple[bool, float]]] = {label: [] for *_, label in BANDS}
    for s in sales:
        earlier = [o for o in sales if o.closed < s.closed and o is not s]
        v = comp_value(s.home, earlier, s.closed, price_index=price_index)
        if v is None:
            continue
        label = next(lbl for lo, hi, lbl in BANDS if lo <= s.price < hi)
        hits[label].append((v.low <= s.price <= v.high, abs(v.mid / s.price - 1)))
    out = []
    for *_, label in BANDS:
        rows = hits[label]
        if rows:
            errors = sorted(e for _, e in rows)
            mid = len(errors) // 2
            median = errors[mid] if len(errors) % 2 else (errors[mid - 1] + errors[mid]) / 2
            out.append(BacktestBand(label, len(rows), round(sum(h for h, _ in rows) / len(rows), 3), round(median, 4)))
    return out
