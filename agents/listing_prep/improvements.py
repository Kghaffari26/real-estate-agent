"""What each improvement would cost and add (Listing Prep P4, SPEC_LISTING_PREP.md §5.4, §5.6).

For every catalog item the confirmed findings point to (plus the prep items every
listing considers), in code, never by a model:

* **Cost**: a quote for this home if there is one, else the team's cost book × the
  quantity (from the findings, or the catalog's rule: floor area, one per finding…).
* **Value**: the team's **value prior** for the item, a recovery ratio range (value
  added at resale ÷ cost), × the cost, × a buyer-relevance factor from the needs this
  home's buyers have (§5.3), bounded to ±10% so relevance can tilt but never make an
  estimate. Priors are the team's own table, with a source column: industry
  cost-vs-value reports can't be embedded without a license (DECISIONS.md). An item
  with no prior is "not enough evidence", never a guess. Local premiums from comparable
  sales (§5.4) replace priors when the MLS feed lands (P7) and raise confidence.
* **Confidence**: Low for anything resting on a prior. **Risk-adjusted value**: High
  uses the midpoint, Moderate the lower-middle, Low the lower bound, so the optimizer
  never buys uncertainty at face value. Net gain is that, minus the expected (middle)
  cost; the high cost is what the optimizer budgets against.

Each item ends in one status: `candidate` (the optimizer may pick it), `avoid`
(risk-adjusted net gain ≤ 0, with the reason), `no_prior`, `no_price`, `no_quantity`
or `too_slow` (it can't be done before the listing date).
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from agents.listing_prep.catalog import (
    BY_KEY,
    HOURS_PER_REPAIR,
    ITEMS,
    PREREQUISITES,
    STAGING_MONTHS,
    CatalogItem,
)

Confidence = Literal["high", "moderate", "low"]
Status = Literal["candidate", "avoid", "no_prior", "no_price", "no_quantity", "too_slow"]
RELEVANCE_BOUNDS = (0.9, 1.1)


@dataclass(frozen=True)
class Prior:
    """The team's value prior for an item: value added at resale ÷ cost."""

    recovery_low: float
    recovery_high: float
    source: str


@dataclass(frozen=True)
class Price:
    unit: str
    low: float | None
    high: float | None


@dataclass
class Estimate:
    key: str
    label: str
    status: Status
    reason: str | None = None
    quantity: float | None = None
    unit: str | None = None
    cost_low: float | None = None
    cost_high: float | None = None
    cost_source: str | None = None  # "quote" | "cost_book"
    value_low: float | None = None
    value_high: float | None = None
    relevance: float = 1.0
    confidence: Confidence = "low"
    risk_value: float | None = None
    risk_net: float | None = None  # risk-adjusted value − the middle cost
    roi: float | None = None  # risk-adjusted net ÷ the middle cost
    days: int = 0
    group: str | None = None
    requires: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    prior_source: str | None = None


def risk_value(low: float, high: float, confidence: Confidence) -> float:
    if confidence == "high":
        return (low + high) / 2
    if confidence == "moderate":
        return low + 0.25 * (high - low)
    return low


def relevance(item: CatalogItem, segments: Iterable[Mapping[str, Any]]) -> float:
    """1 ± up to 10%: how much this home's buyer needs care about the item. Items no
    particular need is tied to (cleaning, repairs) are neutral."""
    segs = list(segments)
    if not segs or not item.needs:
        return 1.0
    weights = [float(s.get("weight", 0)) for s in segs if s.get("key") in item.needs]
    share = sum(weights)  # 0..1: the share of demand that values this item
    lo, hi = RELEVANCE_BOUNDS
    return round(lo + (hi - lo) * min(1.0, share * 2), 4)


def _quantity(item: CatalogItem, price: Price, findings: list[Mapping[str, Any]], facts: Mapping[str, Any], units: Mapping[str, str]) -> float | None:
    """From the findings when they carry a quantity in this item's unit; else the rule."""
    q = [float(f["quantity"]) for f in findings if f.get("quantity") is not None and units.get(str(f.get("fix_item"))) == price.unit]
    if q and item.quantity == "finding":
        return sum(q)
    if item.quantity == "floor_area":
        return float(facts["sqft"]) if facts.get("sqft") else None
    if item.quantity == "per_finding":
        return float(max(1, len(findings)))
    if item.quantity == "one":
        return 1.0
    if item.quantity == "months":
        return float(STAGING_MONTHS)
    if item.quantity == "hours":
        return float(max(2, HOURS_PER_REPAIR * len(findings)))
    return sum(q) if q else None


def estimate_items(
    *,
    findings: Iterable[Mapping[str, Any]],
    facts: Mapping[str, Any],
    cost_book: Mapping[str, Price],
    quotes: Iterable[Mapping[str, Any]] = (),
    priors: Mapping[str, Prior],
    segments: Iterable[Mapping[str, Any]] = (),
    days_to_list: int | None = None,
) -> list[Estimate]:
    """One estimate per catalog item the confirmed findings point to, the prep items,
    and the prerequisites those need. `findings` should already be confirmed/edited only."""
    found = [f for f in findings if f.get("status", "confirmed") in ("confirmed", "edited")]
    segs = list(segments)
    units = {k: p.unit for k, p in cost_book.items()}
    quote_by_item: dict[str, tuple[float, float]] = {}
    for q in quotes:
        lo, hi = float(q["low_usd"]), float(q["high_usd"])
        prev = quote_by_item.get(q["item"])
        quote_by_item[q["item"]] = (min(lo, prev[0]), max(hi, prev[1])) if prev else (lo, hi)

    def related(item: CatalogItem) -> list[Mapping[str, Any]]:
        return [f for f in found if f.get("fix_item") == item.key or f.get("category") in item.categories]

    chosen = {i.key for i in ITEMS if i.always or any(f.get("fix_item") == i.key for f in found) or (related(i) and any(f.get("fix_item") is None for f in related(i)))}
    # Alternatives in a group come in with any member (refinish vs replace, carpet vs LVP).
    groups = {BY_KEY[k].group for k in chosen if BY_KEY[k].group}
    chosen |= {i.key for i in ITEMS if i.group in groups and related(i)}
    chosen |= {r for k in list(chosen) for r in BY_KEY[k].requires}

    out: list[Estimate] = []
    for item in ITEMS:
        if item.key not in chosen:
            continue
        fs = related(item)
        e = Estimate(item.key, item.label, "candidate", days=item.days, group=item.group, requires=sorted(item.requires))
        e.evidence = [f"{f.get('room', '').replace('_', ' ')}: {f.get('issue')}" for f in fs if f.get("issue")][:5]
        if days_to_list is not None and item.days > days_to_list:
            e.status, e.reason = "too_slow", f"Takes about {item.days} working days; the listing is in {days_to_list}."
            out.append(e)
            continue
        price = cost_book.get(item.key)
        if item.key in quote_by_item:
            e.cost_low, e.cost_high = quote_by_item[item.key]
            e.cost_source, e.quantity, e.unit = "quote", None, "job"
        elif price is None or price.low is None or price.high is None:
            e.status, e.reason = "no_price", "No price in the cost book and no quote for this home."
            out.append(e)
            continue
        else:
            qty = _quantity(item, price, fs, facts, units)
            if qty is None:
                e.status, e.reason = "no_quantity", f"Needs a quantity ({price.unit.replace('_', ' ')}): add it on the finding."
                out.append(e)
                continue
            e.quantity, e.unit = qty, price.unit
            e.cost_low, e.cost_high, e.cost_source = price.low * qty, price.high * qty, "cost_book"
        prior = priors.get(item.key)
        if prior is None:
            if item.key in PREREQUISITES:  # a prerequisite is priced even without a value prior
                e.value_low = e.value_high = e.risk_value = 0.0
                e.risk_net = -(e.cost_low + e.cost_high) / 2  # type: ignore[operator]
                e.status, e.reason = "no_prior", "No value prior: counted only as a step other improvements need."
            else:
                e.status, e.reason = "no_prior", "Not enough evidence: no value prior for this item yet (and no comparable sales)."
            out.append(e)
            continue
        cost_mid = (e.cost_low + e.cost_high) / 2  # type: ignore[operator]
        e.relevance = relevance(item, segs)
        e.value_low = cost_mid * prior.recovery_low * e.relevance
        e.value_high = cost_mid * prior.recovery_high * e.relevance
        e.prior_source = prior.source
        e.confidence = "low"  # priors only, until local premiums (P7)
        e.risk_value = risk_value(e.value_low, e.value_high, e.confidence)
        e.risk_net = e.risk_value - cost_mid
        e.roi = e.risk_net / cost_mid if cost_mid else None
        if e.risk_net <= 0:
            e.status = "avoid"
            e.reason = f"Recovers about {prior.recovery_low:.0%}–{prior.recovery_high:.0%} of its cost at resale (team prior: {prior.source}); at the conservative end it doesn’t pay for itself."
        out.append(e)
    return out


def round_up(v: float, step: float = 50.0) -> int:
    """Costs in budget units, rounded up so a plan can't exceed its budget."""
    return int(math.ceil(v / step - 1e-9))
