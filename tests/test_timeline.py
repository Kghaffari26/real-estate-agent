"""§6.4 timelines: the month axis, rounding, gaps, the size budget, and the fetcher's
long-history extract from the Data Center CSVs."""

from __future__ import annotations

from datetime import date

import polars as pl
import pytest

from agents.real_estate import fetch_redfin
from agents.real_estate import timeline as tl
from agents.real_estate.agent import json_size
from agents.real_estate.config import Metro
from tests import redfin_dc_fixtures as dc

METROS = [
    Metro(slug="alpha-tx", name="Alpha, TX", redfin_region="Alpha, TX metro area", cbsa=None, lat=None, lon=None, zillow_region_id=None),
    Metro(slug="beta-tx", name="Beta, TX", redfin_region="Beta, TX metro area", cbsa=None, lat=None, lon=None, zillow_region_id=None),
]  # fmt: skip


def test_month_axis_is_every_month_end_inclusive():
    axis = tl.month_axis(date(2011, 11, 1), date(2012, 2, 29))
    assert axis == [date(2011, 11, 30), date(2011, 12, 31), date(2012, 1, 31), date(2012, 2, 29)]
    assert len(tl.month_axis(date(2012, 1, 1), date(2026, 8, 31))) == 176  # 2012-01 … 2026-08


def test_build_rounds_aligns_and_leaves_gaps_null():
    rows = [
        {"region": "Alpha, TX metro area", "period_end": date(2012, 1, 31), "median_sale_price": 250_123.6, "inventory": 4012.0,
         "median_dom": 41.4, "price_drops": 0.123456, "months_of_supply": 3.24},
        {"region": "Alpha, TX metro area", "period_end": date(2012, 3, 31), "median_sale_price": None, "inventory": float("nan"),
         "median_dom": 39.0, "price_drops": 0.2, "months_of_supply": 3.0},
        {"region": "Beta, TX metro area", "period_end": date(2012, 2, 29), "median_sale_price": 199_999.5, "inventory": 1.0,
         "median_dom": 12.0, "price_drops": None, "months_of_supply": 2.05},
        {"region": "Gamma, TX metro area", "period_end": date(2012, 2, 29), "median_sale_price": 1.0},  # untracked
        {"region": "Alpha, TX metro area", "period_end": date(2011, 12, 31), "median_sale_price": 9.0},  # before `since`
    ]  # fmt: skip
    out = tl.build_timelines(rows, METROS, date(2012, 1, 1), date(2012, 3, 31))
    assert list(out) == list(tl.TIMELINE_METRICS)
    price = out["median_sale_price"]
    assert price.dates == [date(2012, 1, 31), date(2012, 2, 29), date(2012, 3, 31)]
    assert price.metros == {"alpha-tx": [250_124, None, None], "beta-tx": [None, 200_000, None]}
    assert isinstance(price.metros["alpha-tx"][0], int)  # whole numbers publish as ints
    assert out["inventory"].metros["alpha-tx"] == [4012, None, None]  # NaN → null
    assert out["median_dom"].metros["alpha-tx"] == [41, None, 39]
    assert out["price_drops"].metros["alpha-tx"] == [0.123, None, 0.2]
    assert out["months_of_supply"].metros["beta-tx"] == [None, 2.0, None]  # 2.05 is 2.04999… in binary, so it rounds to 2.0
    assert out["months_of_supply"].metros["alpha-tx"][0] == 3.2


def test_fit_drops_oversized_files_with_a_warning_and_refs_describe_the_rest():
    out = tl.build_timelines([], METROS, date(2012, 1, 1), date(2026, 8, 31))
    small = {k: v for k, v in out.items()}
    kept, warnings = tl.fit(small, json_size, max_bytes=10**6)
    assert list(kept) == list(tl.TIMELINE_METRICS) and warnings == []
    kept, warnings = tl.fit(small, lambda t: 2_000 if t.metric == "inventory" else 10, max_bytes=1_000)
    assert "inventory" not in kept and warnings == ["timeline/inventory.json is 2000 bytes (limit 1000); not published this run"]
    [ref, *_] = tl.refs(kept)
    assert ref.metric == "median_sale_price" and ref.path == "timeline/median_sale_price.json"
    assert (ref.start, ref.end, ref.months) == (date(2012, 1, 31), date(2026, 8, 31), 176)


def test_real_size_budget_holds_for_fifty_metros_since_2012():
    """50 metros x 176 months of realistic values stay under the 120 KB budget."""
    metros = [Metro(slug=f"metro-{i:02d}", name=f"M{i}", redfin_region=f"R{i}", cbsa=None, lat=None, lon=None, zillow_region_id=None) for i in range(50)]
    axis = tl.month_axis(date(2012, 1, 1), date(2026, 8, 31))
    rows = [
        {"region": f"R{i}", "period_end": d, "median_sale_price": 1_234_567.0, "inventory": 123_456.0, "median_dom": 123.0,
         "price_drops": 0.123456, "months_of_supply": 12.34}
        for i in range(50) for d in axis
    ]  # fmt: skip
    for key, t in tl.build_timelines(rows, metros, date(2012, 1, 1), date(2026, 8, 31)).items():
        assert json_size(t) <= 120 * 1024, key


def _write(path, body: bytes):
    path.write_bytes(body)
    return path


def test_dc_frame_since_reaches_back_past_the_history_window(tmp_path):
    months = tl.month_axis(date(2012, 1, 1), date(2012, 6, 30)) + tl.month_axis(date(2026, 1, 1), date(2026, 8, 31))
    housing = _write(tmp_path / "h.csv", dc.housing_csv([("Alpha, TX metro area", "1", "Metro", dc.default_values(300000))], months))
    recent = fetch_redfin.dc_frame(housing, None, region_type="metro", history_months=36, tracked_regions=None, today=date(2026, 9, 28))
    assert recent["period_end"].min() >= date(2023, 1, 1)
    full = fetch_redfin.dc_frame(housing, None, region_type="metro", history_months=0, tracked_regions=None, since=date(2012, 1, 1))
    assert full["period_end"].min() == date(2012, 1, 31) and full.height == len(months)


def test_fetch_metro_timeline_reads_the_downloaded_csvs_and_skips_legacy(tmp_path, monkeypatch):
    months = tl.month_axis(date(2012, 1, 1), date(2012, 3, 31))
    csv = _write(tmp_path / "metro.csv", dc.housing_csv([("Alpha, TX metro area", "1", "Metro", dc.default_values(300000))], months))
    monkeypatch.setattr(fetch_redfin, "DC_METRO_CSV_PATH", csv)
    monkeypatch.setattr(fetch_redfin, "DC_PRICE_DROPS_METRO_CSV_PATH", tmp_path / "missing.csv")
    out = tmp_path / "timeline.parquet"
    result = fetch_redfin.FetchResult(modified=True, parquet_path=tmp_path / "x.parquet", data_through=None)
    assert fetch_redfin.fetch_metro_timeline(result, tracked_regions=None, since=date(2012, 1, 1), out_path=out) == out
    frame = pl.read_parquet(out)
    assert frame.height == 3 and frame["price_drops"].null_count() == 3
    # Unchanged source + an existing extract: reused, not rebuilt.
    out.write_bytes(b"sentinel")
    unchanged = fetch_redfin.FetchResult(modified=False, parquet_path=tmp_path / "x.parquet", data_through=None)
    assert fetch_redfin.fetch_metro_timeline(unchanged, tracked_regions=None, since=date(2012, 1, 1), out_path=out) == out
    assert out.read_bytes() == b"sentinel"
    # The legacy export is never spliced into a Data Center timeline.
    legacy = fetch_redfin.FetchResult(modified=True, parquet_path=tmp_path / "x.parquet", data_through=None, source="legacy")
    assert fetch_redfin.fetch_metro_timeline(legacy, tracked_regions=None, since=date(2012, 1, 1), out_path=tmp_path / "l.parquet") is None


@pytest.mark.parametrize("value", ["2012-01", "2012-01-31"])
def test_first_month_parses_config(value):
    from agents.real_estate.agent import _first_month

    assert _first_month(value) == date(2012, 1, 1)
