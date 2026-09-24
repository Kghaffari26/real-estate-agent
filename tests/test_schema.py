from __future__ import annotations

import json
from datetime import date, datetime

import pytest
from pydantic import ValidationError

from agents.real_estate.schema import (
    AffordabilityOut,
    AlertOut,
    Brief,
    CaseShiller,
    ConstructionSeriesValue,
    FlagOut,
    IndexOutput,
    KeyStat,
    MetricRegistryEntry,
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
from core.publish import PublishSizeError, write_json
from core.schema import Citation, RunMeta


def _run_meta() -> RunMeta:
    return RunMeta(
        agent="real_estate",
        started_at=datetime(2026, 9, 24, 12, 0, 0),
        finished_at=datetime(2026, 9, 24, 12, 5, 0),
        cost_usd=0.0,
        status="ok",
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
            "median_sale_price": _metric_value(),
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


# -- core.publish.write_json size limits -----------------------------------


def test_write_json_writes_file_under_the_limit(tmp_path):
    path = tmp_path / "small.json"
    size = write_json(path, {"a": 1}, max_kb=10)
    assert path.exists()
    assert size == len(json.dumps({"a": 1}, separators=(",", ":")).encode("utf-8"))


def test_write_json_raises_publish_size_error_over_the_limit(tmp_path):
    path = tmp_path / "big.json"
    big_payload = {"data": "x" * 5000}
    with pytest.raises(PublishSizeError):
        write_json(path, big_payload, max_kb=1)


def test_write_json_does_not_write_file_when_over_the_limit(tmp_path):
    path = tmp_path / "big.json"
    big_payload = {"data": "x" * 5000}
    with pytest.raises(PublishSizeError):
        write_json(path, big_payload, max_kb=1)
    assert not path.exists()


def test_write_json_no_limit_always_writes(tmp_path):
    path = tmp_path / "unbounded.json"
    big_payload = {"data": "x" * 5000}
    write_json(path, big_payload, max_kb=None)
    assert path.exists()
