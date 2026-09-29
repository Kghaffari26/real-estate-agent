from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from agents_core.schema import ModelUsage, RunMeta, Source
from pydantic import ValidationError

from agents.real_estate.agent import json_size
from agents.real_estate.schema import (
    AffordabilityOut,
    AlertOut,
    Brief,
    CaseShiller,
    Citation,
    ConstructionSeriesValue,
    FlagOut,
    IndexOutput,
    KeyStat,
    MetricRegistryEntry,
    MetricSummaryValue,
    MetricValue,
    MetroDetailOutput,
    MetroSummary,
    Movers,
    NationalBlock,
    NationalConstruction,
    NationalRates,
    PermitsValue,
    RatesLatest,
    TemperatureDetail,
    TemperatureSummary,
)


def _run_meta() -> RunMeta:
    return RunMeta(
        agent="real_estate",
        schema_version="1.0.0",
        run_id="2026-09-24T12-00-00Z-abc123",
        started_at=datetime(2026, 9, 24, 12, 0, 0, tzinfo=UTC),
        finished_at=datetime(2026, 9, 24, 12, 5, 0, tzinfo=UTC),
        status="ok",
        data_changed=True,
        cost_usd=0.0,
        model_usage=ModelUsage(),
        sources=[Source(name="Redfin", url="https://redfin.com", retrieved_at=datetime(2026, 9, 24, tzinfo=UTC))],
    )


def _brief() -> Brief:
    return Brief(
        text="Prices rose modestly this month.",
        key_points=["Prices up 3% YoY"],
        citations=[Citation(name="Redfin", url="https://redfin.com")],
        narrative_source="template",
        generated_at=datetime(2026, 9, 24, 12, 0, 0),
    )


def _metric_value() -> MetricValue:
    return MetricValue(value=350000.0, yoy=0.03, mom=0.01, delta_format="percent_signed")


def _national_block() -> NationalBlock:
    return NationalBlock(
        latest={"mortgage30": _metric_value()},
        temperature=TemperatureSummary(score=55, label="Balanced"),
        series={"dates": ["2026-08-31"], "mortgage30": [6.5]},
        rates=NationalRates(
            dates=["2026-08-31"],
            mortgage30=[6.5],
            mortgage15=[5.9],
            latest=RatesLatest(mortgage30=6.5, mortgage30_change_1w_pp=0.02, mortgage30_year_ago=7.0),
        ),
        construction=NationalConstruction(
            housing_starts=ConstructionSeriesValue(value=1350.0, mom=0.02, units="thousands", period="2026-08"),
            permits=ConstructionSeriesValue(value=1400.0, mom=0.01, units="thousands", period="2026-08"),
            series={"dates": ["2026-08-31"], "housing_starts": [1350.0]},
        ),
        case_shiller=CaseShiller(value=310.5, yoy=0.04, period="2026-06"),
        brief=_brief(),
    )


def _metro_summary(slug: str = "houston-tx") -> MetroSummary:
    return MetroSummary(
        slug=slug,
        name="Houston, TX",
        cbsa="26420",
        lat=29.76,
        lon=-95.36,
        homes_sold_12m=42000,
        latest={
            "median_sale_price": MetricSummaryValue(value=350000.0, yoy=0.03),
            "permits_total": PermitsValue(value=1200.0, yoy_12m=0.05),
        },
        temperature=TemperatureSummary(score=60, label="Warm"),
        market_type="Balanced",
        flags=["price_36m_high"],
        brief_excerpt="Prices rose modestly.",
    )


def _minimal_index_output() -> IndexOutput:
    return IndexOutput(
        meta=_run_meta(),
        headline="Home prices climb nationwide",
        key_stats=[
            KeyStat(label="Median sale price", value=412000, format="currency", delta=0.03, delta_format="percent_signed", good_direction="neutral")
        ],
        data_through=date(2026, 8, 31),
        rates_as_of=date(2026, 9, 20),
        metric_registry=[
            MetricRegistryEntry(
                key="median_sale_price",
                label="Median sale price",
                format="currency",
                change_kind="ratio",
                good_direction="neutral",
                source="redfin",
            )
        ],
        national=_national_block(),
        metros=[_metro_summary()],
        movers=Movers(
            price_gains=[{"slug": "houston-tx", "name": "Houston, TX", "value": 0.05}],
        ),
        alerts=[AlertOut(flag="inventory_surge", label="Inventory surge", severity="notable", slugs=["houston-tx"])],
        sources=[Citation(name="Redfin", url="https://redfin.com")],
    )


def _minimal_metro_detail_output() -> MetroDetailOutput:
    return MetroDetailOutput(
        slug="houston-tx",
        name="Houston, TX",
        cbsa="26420",
        lat=29.76,
        lon=-95.36,
        data_through=date(2026, 8, 31),
        latest={
            "median_sale_price": _metric_value(),
            "permits_total": PermitsValue(value=1200.0, yoy_12m=0.05),
        },
        temperature=TemperatureDetail(score=60, label="Warm", components={"median_dom": 0.5}),
        market_type="Balanced",
        flags=[FlagOut(id="price_36m_high", label="36-month high median sale price", severity="info")],
        affordability=AffordabilityOut(
            payment_now=2528.27,
            payment_year_ago=2400.0,
            payment_change_pct=0.053,
            payment_to_income=0.28,
            median_household_income=90000,
            income_year=2024,
            assumptions={"down_payment_pct": 0.20, "term_years": 30, "rate_now": 6.5, "rate_year_ago": 7.0, "price_year_ago": 380000.0},
        ),
        series={"dates": ["2026-08-31"], "median_sale_price": [412000.0]},
        brief=_brief(),
    )


def test_index_output_round_trips_through_model_dump():
    instance = _minimal_index_output()
    round_tripped = IndexOutput.model_validate(instance.model_dump())
    assert round_tripped == instance


def test_index_output_round_trips_through_json():
    instance = _minimal_index_output()
    payload = json.loads(instance.model_dump_json())
    round_tripped = IndexOutput.model_validate(payload)
    assert round_tripped.headline == instance.headline
    assert round_tripped.metros[0].slug == "houston-tx"


def test_metro_detail_output_round_trips_through_model_dump():
    instance = _minimal_metro_detail_output()
    round_tripped = MetroDetailOutput.model_validate(instance.model_dump())
    assert round_tripped == instance


def test_metro_detail_output_affordability_can_be_none():
    instance = _minimal_metro_detail_output()
    data = instance.model_dump()
    data["affordability"] = None
    round_tripped = MetroDetailOutput.model_validate(data)
    assert round_tripped.affordability is None


def test_metro_detail_output_case_shiller_can_be_none_on_national_block():
    national = _national_block()
    data = national.model_dump()
    data["case_shiller"] = None
    round_tripped = NationalBlock.model_validate(data)
    assert round_tripped.case_shiller is None


def test_index_output_rejects_invalid_change_kind():
    payload = _minimal_index_output().model_dump()
    payload["metric_registry"][0]["change_kind"] = "not-a-real-kind"
    with pytest.raises(ValidationError):
        IndexOutput.model_validate(payload)


# -- published size accounting -------------------------------------------------


def test_json_size_matches_compact_json_bytes():
    assert json_size({"a": 1}) == len(json.dumps({"a": 1}, separators=(",", ":")).encode("utf-8"))


def test_json_size_of_a_model_counts_utf8_bytes():
    brief = _brief().model_copy(update={"text": "é" * 10})
    assert json_size(brief) == len(json.dumps(brief.model_dump(mode="json"), separators=(",", ":"), ensure_ascii=False).encode())


def test_index_output_meta_is_agents_core_run_meta():
    payload = _minimal_index_output().model_dump(mode="json")
    assert payload["meta"]["finished_at"] == "2026-09-24T12:05:00Z"
    # agents-core >= v0.2.0: warnings live in meta (always present, usually empty)
    assert payload["meta"]["warnings"] == [] and payload["meta"]["meta_schema_version"] == "1.1.0"
    payload["meta"]["batch_fallback"] = True  # not a declared meta field
    with pytest.raises(ValidationError):
        IndexOutput.model_validate(payload)


def test_new_fields_are_additive_with_defaults():
    """§6.3 investigations and per-metro alert figures are optional: an index or metro
    file published before them still validates."""
    payload = _minimal_index_output().model_dump(mode="json")
    payload.pop("investigations", None)
    for alert in payload["alerts"]:
        alert.pop("metros", None)
    assert IndexOutput.model_validate(payload).investigations == []


def test_every_published_delta_format_is_an_agents_core_stat_format():
    from typing import get_args

    from agents_core.schema import StatFormat

    from agents.real_estate import metrics

    standard = set(get_args(StatFormat))
    for m in metrics.METRICS:
        assert m.delta_format in standard, (m.key, m.delta_format)
    assert metrics.get("median_dom").delta_format == "count_signed"
    assert metrics.get("months_of_supply").delta_format == "decimal1"
    with pytest.raises(ValidationError):
        MetricValue(value=1, delta_format="days_signed")


def test_fit_index_trims_national_series_beyond_the_core_6_then_fails():
    from types import SimpleNamespace

    from agents.real_estate.agent import (
        CORE_NATIONAL_SERIES_KEYS,
        NATIONAL_SERIES_KEYS,
        PublishSizeError,
        fit_index,
    )

    def body():
        series = {"dates": ["2026-05-31"], **{k: [1.0] * 100 for k in NATIONAL_SERIES_KEYS}}
        return {"national": SimpleNamespace(series=series), "metros": [SimpleNamespace(spark=[1] * 24)]}

    def measure(b):
        return 100 * len(b["national"].series) + 10 * sum(len(m.spark) for m in b["metros"])

    # under the limit: untouched, no warning
    b, warnings = fit_index(body(), measure, 10_000)
    assert len(b["national"].series) == 9 and warnings == []
    # over it: the non-core series go (§10) and it says so
    b, warnings = fit_index(body(), measure, 1000)
    assert set(b["national"].series) == {"dates", *CORE_NATIONAL_SERIES_KEYS}
    assert len(warnings) == 1 and "§10" in warnings[0]
    assert len(b["metros"][0].spark) == 24
    # still over: metros[].spark goes next (§6.3, 1.2.0)
    b, warnings = fit_index(body(), measure, 800)
    assert b["metros"][0].spark == [] and len(warnings) == 2 and "spark" in warnings[1]
    # still over after trimming: fail rather than publish an oversized index
    with pytest.raises(PublishSizeError):
        fit_index(body(), measure, 500)


def test_spark_series_is_the_last_24_month_ends_rounded():
    from datetime import date

    from agents.real_estate.agent import spark_series

    rows = [{"period_end": date(2026, m, [31, 28, 31, 30, 31, 30, 31, 31][m - 1]), "median_sale_price": 400000.4 + m} for m in range(1, 9)]
    out = spark_series(rows, date(2026, 8, 31))
    assert len(out) == 24
    assert out[-1] == 400008 and out[-8] == 400001
    assert out[0] is None  # months before the data are null
    assert spark_series(rows, None) == []


def test_committed_json_schema_is_current(tmp_path):
    from agents.real_estate.schema import export_json_schema

    out = tmp_path / "schema.json"
    export_json_schema(out)
    committed = Path(__file__).parent.parent / "schemas" / "real_estate.schema.json"
    assert out.read_text() == committed.read_text(), "run scripts/export_re_schema.py"


def test_index_metro_summaries_carry_only_value_and_yoy():
    """§6.1: `metros[].latest.<metric>` is `{value, yoy}`; the rest is in the metro file.
    (Before, every summary also serialized 7 always-null fields: ~70KB of the index.)"""
    dumped = _metro_summary().model_dump(mode="json")
    assert dumped["latest"]["median_sale_price"] == {"value": 350000.0, "yoy": 0.03}
