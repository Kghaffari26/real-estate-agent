"""Pydantic output models — the site contract (SPEC_REAL_ESTATE.md §6).

`IndexOutput` is the agent's `latest.json` (an `agents_core.schema.AgentOutput`,
so its `meta` block is agents-core's shared `RunMeta`); `MetroDetailOutput` is
each `metros/<slug>.json`. agents-core's runner publishes `IndexOutput`'s JSON
Schema as `schema.json` on the data branch; `scripts/export_re_schema.py` also
writes a combined index + metro-detail schema to `schemas/real_estate.schema.json`
so the site and the pipeline can never silently drift apart.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from typing import Any, Literal

from agents_core.schema import AgentOutput, KeyStat, NarrativeSource, StatFormat
from pydantic import BaseModel, Field

GoodDirection = Literal["up", "down", "neutral"]
Trend = Literal["up", "down", "flat"]
Severity = Literal["info", "notable", "major"]


class MetricValue(BaseModel):
    value: float | int | None
    yoy: float | None = None
    mom: float | None = None
    # One of agents-core's standard formats (never a local one like "days_signed").
    delta_format: StatFormat | None = None
    trend_3m: Trend | None = None
    high_36m: bool | None = None
    low_36m: bool | None = None
    pct_rank: float | None = None
    yoy_pct_rank: float | None = None


class MetricSummaryValue(BaseModel):
    """`metros[].latest.<metric>` in the index (§6.1): just `value` and `yoy`. The full
    `MetricValue` (mom, delta_format, ranks, ...) is in `metros/<slug>.json`."""

    value: float | int | None
    yoy: float | None = None


class PermitsValue(BaseModel):
    """Permits use a rolling-12-month YoY instead of yoy/mom/trend (§5.1)."""

    value: float | None
    yoy_12m: float | None = None


class Citation(BaseModel):
    """A source attribution on a brief or in `sources` (§6.1). Deliberately not
    agents-core's `Citation` (source/url/note): §6's shape is name/url/attribution."""

    name: str
    url: str
    attribution: str | None = None


class MetricRegistryEntry(BaseModel):
    key: str
    label: str
    format: str
    change_kind: Literal["ratio", "pp", "diff"]
    good_direction: GoodDirection
    source: str
    note: str | None = None


class BriefDraft(BaseModel):
    """What the LLM returns (structured output); code adds citations/metadata."""

    text: str
    key_points: list[str]


class Brief(BaseModel):
    text: str
    key_points: list[str] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    narrative_source: NarrativeSource
    model: str | None = None
    generated_at: datetime
    reused: bool = False


class FlagOut(BaseModel):
    id: str
    label: str
    severity: Severity
    facts: dict[str, float] = Field(default_factory=dict)


class AlertMetro(BaseModel):
    """One metro in an alert group, with its own figure (the group label is a threshold)."""

    slug: str
    name: str
    label: str = Field(description="This metro's own flag label, e.g. 'Inventory -24% YoY'")
    value: float | None = Field(default=None, description="The flagged value, as a ratio/diff")
    severity: Severity


class AlertOut(BaseModel):
    flag: str
    label: str = Field(description="The group's threshold, e.g. 'Inventory down ≥20% YoY'")
    severity: Severity = Field(description="The highest severity in the group")
    slugs: list[str]
    metros: list[AlertMetro] = Field(default_factory=list)


class MoverEntry(BaseModel):
    slug: str
    name: str
    value: float


class TemperatureSummary(BaseModel):
    score: int | None
    label: str | None
    basis: str | None = None


class TemperatureDetail(BaseModel):
    score: int | None
    label: str | None
    components: dict[str, float] = Field(default_factory=dict)


class AffordabilityOut(BaseModel):
    payment_now: float
    payment_year_ago: float | None = None
    payment_change_pct: float | None = None
    payment_to_income: float | None = None
    median_household_income: int | None = None
    income_year: int | None = None
    assumptions: dict[str, float | None]


class MetroSummary(BaseModel):
    slug: str
    name: str
    cbsa: str | None
    lat: float | None
    lon: float | None
    homes_sold_12m: int | None = None
    latest: dict[str, MetricSummaryValue | PermitsValue]
    temperature: TemperatureSummary
    market_type: str | None
    flags: list[str] = Field(default_factory=list)
    brief_excerpt: str = ""
    stale: bool = False
    spark: list[int | None] = Field(
        default_factory=list,
        description="§6.3 (1.2.0): the last 24 month-end median sale prices, whole dollars, "
        "oldest first, null where missing; for table sparklines without fetching metro files",
    )


class RatesLatest(BaseModel):
    mortgage30: float | None = None
    mortgage30_change_1w_pp: float | None = None
    mortgage30_year_ago: float | None = None


class NationalRates(BaseModel):
    dates: list[str]
    mortgage30: list[float | None]
    mortgage15: list[float | None]
    latest: RatesLatest


class ConstructionSeriesValue(BaseModel):
    value: float | None
    mom: float | None = None
    units: str | None = None
    period: str | None = None


class NationalConstruction(BaseModel):
    housing_starts: ConstructionSeriesValue
    permits: ConstructionSeriesValue
    series: dict[str, list[float | None] | list[str]]


class CaseShiller(BaseModel):
    value: float | None
    yoy: float | None = None
    period: str | None = None


class NationalBlock(BaseModel):
    latest: dict[str, MetricValue]
    temperature: TemperatureSummary
    series: dict[str, list[float | None] | list[str]]
    rates: NationalRates
    construction: NationalConstruction
    case_shiller: CaseShiller | None = None
    brief: Brief


class Movers(BaseModel):
    price_gains: list[MoverEntry] = Field(default_factory=list)
    price_declines: list[MoverEntry] = Field(default_factory=list)
    inventory_growth: list[MoverEntry] = Field(default_factory=list)
    temperature_top: list[MoverEntry] = Field(default_factory=list)
    temperature_bottom: list[MoverEntry] = Field(default_factory=list)


class Investigation(BaseModel):
    """§6.3: the metro investigator's "why this is happening" explanation
    (`metros/<slug>.json` → `investigation`). Additive: null for metros not
    investigated this run."""

    slug: str
    name: str
    trigger: Literal["new_major_flag", "top_mover"]
    trigger_flag: str | None = None
    trigger_label: str
    explanation: str = Field(description="4-6 sentences, numbers checked by the number guard")
    cited_metrics: list[str]
    narrative_source: NarrativeSource
    model: str | None = None
    stop_reason: str = Field(description="The agent loop's stop reason, or 'not_run'")
    steps: int
    tools_called: list[str] = Field(default_factory=list)
    cost_usd: float
    prompt_version: str
    generated_at: datetime
    reused: bool = False


class InvestigationSummary(BaseModel):
    """§6.3: one entry of the index-level `investigations` list."""

    slug: str
    name: str
    trigger: Literal["new_major_flag", "top_mover"]
    trigger_label: str
    summary: str = Field(description="The explanation's first sentence")
    cited_metrics: list[str]
    narrative_source: NarrativeSource
    stop_reason: str


class TimelineOutput(BaseModel):
    """§6.4 `timeline/<metric>.json`: one metric, every tracked metro, monthly."""

    metric: str
    dates: list[date] = Field(description="Month ends, oldest first, shared by every metro's series")
    metros: dict[str, list[int | float | None]] = Field(
        description="slug -> values aligned to `dates` (rounded Redfin levels; null where not reported)"
    )


class TimelineRef(BaseModel):
    """§6.4: which timeline files this run published (the site fetches only these)."""

    metric: str
    path: str
    start: date
    end: date
    months: int


EventKind = Literal[
    "rate_high",
    "rate_low",
    "price_yoy_turn_up",
    "price_yoy_turn_down",
    "price_yoy_high",
    "price_yoy_low",
    "inventory_yoy_high",
    "inventory_yoy_low",
]


class NationalEvent(BaseModel):
    """§6.5 one national moment, detected in code (`events.py`, documented thresholds)."""

    date: date
    kind: EventKind
    metric: Literal["mortgage30", "median_sale_price", "inventory"]
    value: float = Field(description="mortgage30: the rate in percent; others: the YoY ratio that month")
    prominence: float | None = Field(default=None, description="Rate turns: prominence in percentage points")


class EventsOutput(BaseModel):
    """§6.5 `events.json`: the national event rail."""

    since: date
    through: date
    rules: dict[str, float] = Field(description="The thresholds this file was detected with")
    events: list[NationalEvent]


class PulseOutput(BaseModel):
    """§6.6 `pulse.json`: the last weeks of Redfin's rolling 4-week metro data."""

    window_weeks: int = Field(description="Each point is a rolling window of this many weeks, ending on its date")
    weeks: list[date] = Field(description="Window end dates, oldest first, shared by every series")
    metros: dict[str, dict[str, list[int | None]]] = Field(description="slug -> metric -> values aligned to `weeks`")
    yoy: dict[str, dict[str, float | None]] = Field(
        description="slug -> metric -> latest window vs the window ending 52 weeks earlier (ratio)"
    )


class AreaOut(BaseModel):
    """§6.7 one county within a metro, with its latest month and YoY (computed here)."""

    name: str
    geoid: str | None = None
    lat: float | None = None
    lon: float | None = None
    median_sale_price: int | None = None
    median_sale_price_yoy: float | None = None
    inventory: int | None = None
    inventory_yoy: float | None = None
    homes_sold: int | None = None
    homes_sold_yoy: float | None = None


class AreasOutput(BaseModel):
    """§6.7 `areas/<slug>.json`: the counties in one metro."""

    slug: str
    level: Literal["county"] = "county"
    data_through: date
    areas: list[AreaOut]


class ExtensionRef(BaseModel):
    """§6.5-6.7: a published extension file (the site fetches only what's listed)."""

    path: str
    count: int = Field(description="events: events; pulse: metros; areas: counties")
    through: date


class AreaRef(BaseModel):
    slug: str
    path: str
    count: int


class RegionMetric(BaseModel):
    value: float | int | None = None
    yoy: float | None = Field(default=None, description="Same change rule as the metro pipeline (registry change_kind)")


class RegionArea(BaseModel):
    """v3 §4.2: one ZIP, one city (aggregated from its ZIPs) or the region summary."""

    id: str = Field(description="ZIP code, Census place GEOID, or the region slug")
    name: str
    kind: Literal["zip", "city", "region"]
    city: str | None = Field(default=None, description="ZIPs: the city with the most land overlap")
    zips: list[str] = Field(default_factory=list, description="Cities and the region: member ZIPs")
    lat: float | None = None
    lon: float | None = None
    latest: dict[str, RegionMetric]
    series: dict[str, list[float | int | None]] = Field(description="metric -> values aligned to the region's `dates`")
    ranks: dict[str, int] = Field(default_factory=dict, description="Within the region: 1 = highest price / fastest growth / fewest days")
    low_sample: bool = Field(default=False, description="Fewer than 10 homes sold in the window: volatile values, left out of ranks")


class RegionOutput(BaseModel):
    """v3 §4.2 `regions/<slug>.json`: a county-scale market down to ZIP and city."""

    slug: str
    name: str
    metros: list[str]
    data_through: date
    window: Literal["rolling_3_months"] = "rolling_3_months"
    dates: list[date] = Field(description="Month ends of the 36-month series, oldest first")
    summary: RegionArea
    cities: list[RegionArea]
    zips: list[RegionArea]


class RegionGeometry(BaseModel):
    """v3 §4.2 `regions/<slug>.geo.json`: simplified ZIP (ZCTA) and city boundaries (GeoJSON)."""

    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[dict[str, Any]]


class RegionRef(BaseModel):
    slug: str
    name: str
    path: str
    geometry: str | None = None
    zips: int
    cities: int
    through: date


class IndexOutput(AgentOutput):
    headline: str
    key_stats: list[KeyStat]
    data_through: date
    rates_as_of: date
    metric_registry: list[MetricRegistryEntry]
    national: NationalBlock
    metros: list[MetroSummary]
    movers: Movers
    alerts: list[AlertOut]
    sources: list[Citation]
    investigations: list[InvestigationSummary] = Field(default_factory=list)  # §6.3, additive
    timelines: list[TimelineRef] = Field(default_factory=list)  # §6.4, additive (1.3.0)
    events: ExtensionRef | None = None  # §6.5, additive (1.4.0)
    pulse: ExtensionRef | None = None  # §6.6, additive (1.4.0)
    areas: list[AreaRef] = Field(default_factory=list)  # §6.7, additive (1.4.0)
    regions: list[RegionRef] = Field(default_factory=list)  # v3 §4.2, additive (1.5.0)


class MetroDetailOutput(BaseModel):
    slug: str
    name: str
    cbsa: str | None
    lat: float | None
    lon: float | None
    data_through: date
    latest: dict[str, MetricValue | PermitsValue]
    temperature: TemperatureDetail
    market_type: str | None
    flags: list[FlagOut]
    affordability: AffordabilityOut | None
    series: dict[str, list[float | None] | list[str]]
    brief: Brief
    stale: bool = False
    investigation: Investigation | None = None  # §6.3, additive


def export_json_schema(path: Path | str = Path("schemas/real_estate.schema.json")) -> None:
    """Writes a combined JSON Schema document (index, metro detail and the §6.5-6.7 files) used
    by the site and by `tests/test_schema.py`'s stability snapshot."""
    combined = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "real_estate",
        "definitions": {
            "IndexOutput": IndexOutput.model_json_schema(),
            "MetroDetailOutput": MetroDetailOutput.model_json_schema(),
            # §6.5-6.7 extension files (1.4.0)
            "EventsOutput": EventsOutput.model_json_schema(),
            "PulseOutput": PulseOutput.model_json_schema(),
            "AreasOutput": AreasOutput.model_json_schema(),
            # v3 §4.2 regions (1.5.0)
            "RegionOutput": RegionOutput.model_json_schema(),
            "RegionGeometry": RegionGeometry.model_json_schema(),
        },
    }
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(combined, indent=2, sort_keys=True) + "\n")
