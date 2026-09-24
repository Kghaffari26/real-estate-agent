"""Market temperature: how competitive a metro is *relative to the other
tracked metros* (SPEC_REAL_ESTATE.md §5.3). The site's tooltip should say
so explicitly — this is not an absolute measure of a hot or cold market.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field

#: component -> its sign in the score (+1 favors sellers/speed, -1 the opposite)
COMPONENTS: dict[str, int] = {
    "avg_sale_to_list": 1,
    "sold_above_list": 1,
    "off_market_in_two_weeks": 1,
    "median_dom": -1,
    "price_drops": -1,
    "months_of_supply": -1,
}


@dataclass
class Temperature:
    score: int | None
    label: str | None
    components: dict[str, float] = field(default_factory=dict)


def _phi(x: float) -> float:
    """Standard normal CDF."""
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def label_for_score(score: int, bands: tuple[int, int, int, int] = (80, 60, 40, 20)) -> str:
    hot, warm, balanced, cool = bands
    if score >= hot:
        return "Hot"
    if score >= warm:
        return "Warm"
    if score >= balanced:
        return "Balanced"
    if score >= cool:
        return "Cool"
    return "Cold"


def compute_temperatures(
    values_by_slug: dict[str, dict[str, float | None]],
    min_components: int = 4,
    bands: tuple[int, int, int, int] = (80, 60, 40, 20),
) -> dict[str, Temperature]:
    """`values_by_slug[slug][component]` is that metro's latest raw value for
    each of the six `COMPONENTS`. Each component is z-scored across the
    metros that have it; `score_raw` is the mean of the *signed* z-scores
    (so every component in `Temperature.components` is already
    direction-adjusted: positive always means "hotter"), requiring at least
    `min_components` of the 6 to be non-null.
    """
    z_by_component: dict[str, dict[str, float]] = {}
    for component in COMPONENTS:
        pairs = [
            (slug, v[component]) for slug, v in values_by_slug.items() if v.get(component) is not None
        ]
        if len(pairs) < 2:
            z_by_component[component] = {}
            continue
        vals = [p[1] for p in pairs]
        mean = statistics.fmean(vals)
        stdev = statistics.pstdev(vals)
        z_by_component[component] = (
            {slug: 0.0 for slug, _ in pairs}
            if stdev == 0
            else {slug: (v - mean) / stdev for slug, v in pairs}
        )

    out: dict[str, Temperature] = {}
    for slug in values_by_slug:
        signed_components: dict[str, float] = {}
        for component, direction in COMPONENTS.items():
            z = z_by_component[component].get(slug)
            if z is None:
                continue
            signed_components[component] = round(z * direction, 3)
        if len(signed_components) < min_components:
            out[slug] = Temperature(score=None, label=None, components=signed_components)
            continue
        score_raw = statistics.fmean(signed_components.values())
        score = round(100 * _phi(score_raw))
        out[slug] = Temperature(score=score, label=label_for_score(score, bands), components=signed_components)
    return out


def compute_temperature_own_history(
    latest_values: dict[str, float | None],
    history_by_component: dict[str, list[float]],
    min_components: int = 4,
    bands: tuple[int, int, int, int] = (80, 60, 40, 20),
) -> Temperature:
    """The national variant (§5.3.6): each component's z-score is against
    *its own* trailing history rather than other metros, so the basis is
    "vs its own 3-year history" instead of "vs the 50 largest metros"."""
    signed: dict[str, float] = {}
    for component, direction in COMPONENTS.items():
        hist = history_by_component.get(component) or []
        val = latest_values.get(component)
        if val is None or len(hist) < 2:
            continue
        mean = statistics.fmean(hist)
        stdev = statistics.pstdev(hist)
        z = 0.0 if stdev == 0 else (val - mean) / stdev
        signed[component] = round(z * direction, 3)

    if len(signed) < min_components:
        return Temperature(score=None, label=None, components=signed)
    score_raw = statistics.fmean(signed.values())
    score = round(100 * _phi(score_raw))
    return Temperature(score=score, label=label_for_score(score, bands), components=signed)


def market_type(months_of_supply: float | None) -> str | None:
    """Absolute measure (§5.3.5), unlike the relative temperature score."""
    if months_of_supply is None:
        return None
    if months_of_supply < 3:
        return "Seller's market"
    if months_of_supply <= 6:
        return "Balanced"
    return "Buyer's market"
