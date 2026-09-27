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
from typing import Literal

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
    """Writes a combined JSON Schema document (index + metro detail) used
    by the site and by `tests/test_schema.py`'s stability snapshot."""
    combined = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "real_estate",
        "definitions": {
            "IndexOutput": IndexOutput.model_json_schema(),
            "MetroDetailOutput": MetroDetailOutput.model_json_schema(),
        },
    }
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(combined, indent=2, sort_keys=True) + "\n")
