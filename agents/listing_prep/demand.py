"""Buyer demand by need (Listing Prep P3, SPEC_LISTING_PREP.md §5.3).

Segments are defined by what buyers *need from the property*, never by who they are.
Each segment's weight = how well this home fits the need (its confirmed facts and price)
× how common that need is in the home's ZIP relative to the county (Census ACS 5-year).

The ACS variables are chosen for fair housing: household size, working from home,
tenure, rents, incomes and home values. **No** age, children or family type, race,
ethnicity, national origin, sex, disability or religion are fetched or used, so no
segment can become a proxy for a protected class. The segment texts are checked against
`fair_housing.py` in the tests. Demand data sizes the needs to address in preparation;
it is never used to target or exclude anyone in marketing.

Needs the Census API key (CENSUS_API_KEY); without it, `fetch_acs` returns None and the
report says demand couldn't be sized.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

from agents_core.http import Http, HttpError

ACS_YEAR = 2023
ACS_URL = f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5"
ORANGE_COUNTY = {"state": "06", "county": "059"}

VARIABLES = {
    "households": "B11016_001E",
    "one_person": "B11016_010E",
    "two_person": ["B11016_003E", "B11016_011E"],
    "four_plus": ["B11016_005E", "B11016_006E", "B11016_007E", "B11016_008E", "B11016_013E", "B11016_014E", "B11016_015E", "B11016_016E"],
    "workers": "B08301_001E",
    "work_from_home": "B08301_021E",
    "occupied": "B25003_001E",
    "renter": "B25003_003E",
    "median_rent": "B25064_001E",
    "income_households": "B19001_001E",
    "income_200k_plus": "B19001_017E",
    "median_value": "B25077_001E",
}


def _codes() -> list[str]:
    out: list[str] = []
    for v in VARIABLES.values():
        out += v if isinstance(v, list) else [v]
    return out


@dataclass(frozen=True)
class AreaStats:
    """Shares of households/workers, and two medians, for one area."""

    small_households: float  # 1–2 person households
    large_households: float  # 4+ person households
    work_from_home: float  # share of workers
    renter: float  # share of occupied homes
    high_income: float  # share of households with $200K+
    median_rent: float | None
    median_value: float | None


def stats_from_row(row: dict[str, Any]) -> AreaStats | None:
    def num(code: str) -> float:
        try:
            v = float(row.get(code) or 0)
        except (TypeError, ValueError):
            return 0.0
        return v if v >= 0 else 0.0  # the ACS uses large negatives for "not available"

    def total(key: str) -> float:
        v = VARIABLES[key]
        return sum(num(c) for c in v) if isinstance(v, list) else num(v)

    hh, workers, occupied, inc = total("households"), total("workers"), total("occupied"), total("income_households")
    if hh <= 0 or workers <= 0 or occupied <= 0 or inc <= 0:
        return None
    return AreaStats(
        small_households=(total("one_person") + total("two_person")) / hh,
        large_households=total("four_plus") / hh,
        work_from_home=total("work_from_home") / workers,
        renter=total("renter") / occupied,
        high_income=total("income_200k_plus") / inc,
        median_rent=total("median_rent") or None,
        median_value=total("median_value") or None,
    )


def fetch_acs(http: Http, zcta: str, *, api_key: str | None = None) -> tuple[AreaStats, AreaStats] | None:
    """(the ZIP's stats, Orange County's), or None without a key or on any failure."""
    key = api_key if api_key is not None else os.environ.get("CENSUS_API_KEY", "")
    if not key:
        return None
    get = ",".join(_codes())
    try:
        z = http.get_json(ACS_URL, params={"get": get, "for": f"zip code tabulation area:{zcta}", "key": key}, ttl_seconds=30 * 86400)
        c = http.get_json(ACS_URL, params={"get": get, "for": f"county:{ORANGE_COUNTY['county']}", "in": f"state:{ORANGE_COUNTY['state']}", "key": key}, ttl_seconds=30 * 86400)
    except (HttpError, ValueError):
        return None

    def first(table: Any) -> dict[str, Any] | None:
        if not isinstance(table, list) or len(table) < 2:
            return None
        return dict(zip(table[0], table[1], strict=False))

    zr, cr = first(z), first(c)
    zs = stats_from_row(zr) if zr else None
    cs = stats_from_row(cr) if cr else None
    return (zs, cs) if zs and cs else None


@dataclass(frozen=True)
class Segment:
    key: str
    label: str
    weight: float
    priorities: list[str]
    evidence: list[str] = field(default_factory=list)


SEGMENTS: dict[str, tuple[str, list[str]]] = {
    "more_space": ("More space", ["bedroom count and size", "storage and closets", "a usable yard", "a flexible bonus room"]),
    "work_from_home": ("Work from home", ["a quiet room that works as an office", "good natural light", "strong internet readiness", "built-in desk or shelving"]),
    "low_maintenance": ("Single-level, low-maintenance living", ["single-level or main-floor bedroom", "low-maintenance finishes and landscaping", "updated kitchen and baths", "move-in ready condition"]),
    "investor": ("Investor", ["rentable layout", "durable finishes", "low near-term repair needs", "rent relative to price"]),
    "luxury": ("Luxury", ["high-end finishes", "outdoor living space", "privacy", "statement kitchen and primary suite"]),
}


def _index(share: float, county: float) -> float:
    """How common a need is here vs the county, bounded so one ZIP can't dominate."""
    return max(0.5, min(2.0, share / county)) if county > 0 else 1.0


def segments(facts: dict[str, Any], price: float | None, area: AreaStats, county: AreaStats) -> list[Segment]:
    """Segments with weight > 0, heaviest first, weights summing to 1."""
    beds = facts.get("beds") or 0
    sqft = facts.get("sqft") or 0
    stories = facts.get("stories")
    ptype = facts.get("property_type")
    lot = facts.get("lot_sqft") or 0
    fit = {
        "more_space": min(1.0, max(0.0, (beds - 2) / 2)) * (1.0 if sqft >= 1600 else 0.6) * (1.0 if ptype == "single_family" or lot >= 4000 else 0.6),
        "work_from_home": 1.0 if beds >= 3 else 0.5 if beds == 2 else 0.2,
        "low_maintenance": (1.0 if stories == 1 or ptype in {"condo", "townhouse"} else 0.4) * (1.0 if sqft <= 1900 else 0.6),
        "investor": 0.0,
        "luxury": 0.0,
    }
    evidence: dict[str, list[str]] = {k: [] for k in SEGMENTS}
    if price and area.median_rent:
        gross_yield = area.median_rent * 12 / price
        fit["investor"] = max(0.0, min(1.0, (gross_yield - 0.025) / 0.02))
        evidence["investor"].append(f"ZIP median rent ${area.median_rent:,.0f}/month is {gross_yield:.1%} a year of this price")
    if price and county.median_value:
        fit["luxury"] = max(0.0, min(1.0, (price / county.median_value - 1.5) / 1.5))
        evidence["luxury"].append(f"this price is {price / county.median_value:.1f}× the county’s median home value")
    idx = {
        "more_space": _index(area.large_households, county.large_households),
        "work_from_home": _index(area.work_from_home, county.work_from_home),
        "low_maintenance": _index(area.small_households, county.small_households),
        "investor": _index(area.renter, county.renter),
        "luxury": _index(area.high_income, county.high_income),
    }
    shares = {
        "more_space": ("households of 4 or more", area.large_households, county.large_households),
        "work_from_home": ("workers who work from home", area.work_from_home, county.work_from_home),
        "low_maintenance": ("households of 1 or 2", area.small_households, county.small_households),
        "investor": ("homes that are rented", area.renter, county.renter),
        "luxury": ("households earning $200K or more", area.high_income, county.high_income),
    }
    for k, (what, here, there) in shares.items():
        evidence[k].append(f"{here:.0%} of {what} in this ZIP vs {there:.0%} in the county")
    raw = {k: fit[k] * idx[k] for k in SEGMENTS}
    total = sum(raw.values())
    if total <= 0:
        return []
    out = [Segment(k, SEGMENTS[k][0], round(raw[k] / total, 3), SEGMENTS[k][1], evidence[k]) for k in SEGMENTS if raw[k] > 0]
    return sorted(out, key=lambda s: s.weight, reverse=True)
