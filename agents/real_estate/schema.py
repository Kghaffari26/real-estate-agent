"""Pydantic output models — the site contract (SPEC_REAL_ESTATE.md §6).

Exported to `schemas/real_estate.schema.json` (see
`scripts/export_re_schema.py`) so the site and the pipeline can never
silently drift apart.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from core.schema import Citation, RunMeta

NarrativeSource = Literal["llm", "template"]
GoodDirection = Literal["up", "down", "neutral"]
Trend = Literal["up", "down", "flat"]
Severity = Literal["info", "notable", "major"]


class MetricValue(BaseModel):
    value: float | int | None
    yoy: float | None = None
    mom: float | None = None
    delta_format: str | None = None
    trend_3m: Trend | None = None
    high_36m: bool | None = None
    low_36m: bool | None = None
    pct_rank: float | None = None
    yoy_pct_rank: float | None = None


class PermitsValue(BaseModel):
    """Permits use a rolling-12-month YoY instead of yoy/mom/trend (§5.1)."""

    value: float | None
    yoy_12m: float | None = None


class KeyStat(BaseModel):
    label: str
    value: float | int
    format: str
    delta: float | None = None
    delta_format: str | None = None
    good_direction: GoodDirection = "neutral"


class MetricRegistryEntry(BaseModel):
    key: str
    label: str
    format: str
    change_kind: Literal["ratio", "pp", "diff"]
    good_direction: GoodDirection
    source: str
    note: str | None = None


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


class AlertOut(BaseModel):
    flag: str
    label: str
    severity: Severity
    slugs: list[str]


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
    latest: dict[str, MetricValue | PermitsValue]
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


class IndexOutput(BaseModel):
    meta: RunMeta
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
