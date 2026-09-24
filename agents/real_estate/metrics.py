"""The metric registry (SPEC_REAL_ESTATE.md §2): the single source of truth
for every metric's label, format, source, and how its year-over-year and
month-over-month changes are computed and displayed.

Both the compute pipeline and the published `metric_registry` block read
from here, so the site and the Python pipeline can never disagree about
what a number means. Never hardcode a metric's label or change semantics
anywhere else.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Format = Literal["currency", "count", "decimal1", "days", "percent"]
ChangeKind = Literal["ratio", "pp", "diff"]
GoodDirection = Literal["up", "down", "neutral"]
Source = Literal["redfin", "zillow", "census_bps", "fred"]


@dataclass(frozen=True)
class Metric:
    key: str
    label: str
    source: Source
    format: Format
    change_kind: ChangeKind
    good_direction: GoodDirection = "neutral"
    note: str | None = None
    national_only: bool = False
    rolling_12m: bool = False  # permits: YoY uses a rolling 12-month sum, not a raw monthly one
    unit: str | None = None  # for "diff" metrics: what the delta is measured in (days, months, pp)

    @property
    def delta_format(self) -> str:
        return {
            "ratio": "percent_signed",
            "pp": "pp_signed",
            "diff": f"{self.unit}_signed" if self.unit else "diff_signed",
        }[self.change_kind]

    def to_site_dict(self) -> dict[str, object]:
        d: dict[str, object] = {
            "key": self.key,
            "label": self.label,
            "format": self.format,
            "change_kind": self.change_kind,
            "good_direction": self.good_direction,
            "source": self.source,
        }
        if self.note:
            d["note"] = self.note
        return d


METRICS: tuple[Metric, ...] = (
    Metric(
        "median_sale_price",
        "Median sale price",
        "redfin",
        "currency",
        "ratio",
        note="Not seasonally adjusted, so compare YoY",
    ),
    Metric("homes_sold", "Homes sold", "redfin", "count", "ratio", good_direction="up"),
    Metric("new_listings", "New listings", "redfin", "count", "ratio"),
    Metric("inventory", "Active inventory", "redfin", "count", "ratio"),
    Metric(
        "months_of_supply",
        "Months of supply",
        "redfin",
        "decimal1",
        "diff",
        unit="months",
        note="< 3 favors sellers, > 6 favors buyers",
    ),
    Metric("median_dom", "Median days on market", "redfin", "days", "diff", unit="days"),
    Metric("avg_sale_to_list", "Sale-to-list ratio", "redfin", "percent", "pp"),
    Metric("sold_above_list", "Sold above list", "redfin", "percent", "pp", note="Share of sales"),
    Metric(
        "price_drops",
        "Listings with price drops",
        "redfin",
        "percent",
        "pp",
        note="Share of active listings",
    ),
    Metric(
        "off_market_in_two_weeks",
        "Off market in 2 weeks",
        "redfin",
        "percent",
        "pp",
        note="Speed signal",
    ),
    Metric(
        "zhvi",
        "Zillow Home Value Index",
        "zillow",
        "currency",
        "ratio",
        note="Smoothed and seasonally adjusted, mid-tier",
    ),
    Metric("zori", "Zillow Observed Rent Index", "zillow", "currency", "ratio", note="Monthly rent"),
    Metric(
        "permits_total",
        "Building permits (units)",
        "census_bps",
        "count",
        "ratio",
        rolling_12m=True,
        note="Monthly units authorized",
    ),
    Metric(
        "permits_1unit",
        "Single-family permits",
        "census_bps",
        "count",
        "ratio",
        rolling_12m=True,
    ),
    Metric(
        "permits_5plus",
        "5+ unit permits",
        "census_bps",
        "count",
        "ratio",
        rolling_12m=True,
        note="Multifamily pipeline",
    ),
    # National-only series (FRED)
    Metric(
        "mortgage30",
        "30-yr fixed mortgage rate",
        "fred",
        "percent",
        "diff",
        unit="pp",
        national_only=True,
    ),
    Metric(
        "mortgage15",
        "15-yr fixed mortgage rate",
        "fred",
        "percent",
        "diff",
        unit="pp",
        national_only=True,
    ),
    Metric(
        "housing_starts",
        "Housing starts",
        "fred",
        "count",
        "ratio",
        national_only=True,
        note="Thousands, SAAR",
    ),
    Metric(
        "permits_national",
        "Building permits (national)",
        "fred",
        "count",
        "ratio",
        national_only=True,
        note="Thousands, SAAR",
    ),
    Metric(
        "case_shiller",
        "Case-Shiller Home Price Index",
        "fred",
        "decimal1",
        "ratio",
        national_only=True,
        note="Index, NSA, about a 2-month lag",
    ),
    Metric(
        "median_price_new_and_existing",
        "Median sale price (new + existing)",
        "fred",
        "currency",
        "ratio",
        national_only=True,
        note="Quarterly",
    ),
)

_BY_KEY: dict[str, Metric] = {m.key: m for m in METRICS}

#: Metrics tracked per metro, in registry order.
METRO_METRIC_KEYS: tuple[str, ...] = tuple(m.key for m in METRICS if not m.national_only)

#: National-only series, in registry order.
NATIONAL_ONLY_KEYS: tuple[str, ...] = tuple(m.key for m in METRICS if m.national_only)


def get(key: str) -> Metric:
    return _BY_KEY[key]


def registry_for_site() -> list[dict[str, object]]:
    """The `metric_registry` block published in `latest.json` (§6.1)."""
    return [m.to_site_dict() for m in METRICS]
