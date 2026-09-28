from __future__ import annotations

import gzip
from pathlib import Path

import httpx
import polars as pl
import pytest
import respx
from agents_core.http import Http

from agents.real_estate import fetch_redfin
from agents.real_estate.fetch_redfin import (
    COLUMN_RENAME,
    RedfinColumnsMissing,
    _filter_to_parquet,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "real_estate"

HEADER = [
    "PERIOD_BEGIN",
    "PERIOD_END",
    "REGION_TYPE",
    "REGION",
    "STATE_CODE",
    "PROPERTY_TYPE",
    "TABLE_ID",
    "PERIOD_DURATION",
    "IS_SEASONALLY_ADJUSTED",
    "MEDIAN_SALE_PRICE",
    "HOMES_SOLD",
    "NEW_LISTINGS",
    "INVENTORY",
    "MONTHS_OF_SUPPLY",
    "MEDIAN_DOM",
    "AVG_SALE_TO_LIST",
    "SOLD_ABOVE_LIST",
    "PRICE_DROPS",
    "OFF_MARKET_IN_TWO_WEEKS",
    "LAST_UPDATED",
    "PARENT_METRO_REGION",
    "PARENT_METRO_REGION_METRO_CODE",
]


def _row(**overrides) -> list[str]:
    base = {
        "PERIOD_BEGIN": "2026-08-01",
        "PERIOD_END": "2026-08-31",
        "REGION_TYPE": "metro",
        "REGION": "Houston, TX metro area",
        "STATE_CODE": "TX",
        "PROPERTY_TYPE": "All Residential",
        "TABLE_ID": "1",
        "PERIOD_DURATION": "30",
        "IS_SEASONALLY_ADJUSTED": "f",
        "MEDIAN_SALE_PRICE": "350000",
        "HOMES_SOLD": "1200",
        "NEW_LISTINGS": "1500",
        "INVENTORY": "4000",
        "MONTHS_OF_SUPPLY": "3.2",
        "MEDIAN_DOM": "25",
        "AVG_SALE_TO_LIST": "0.98",
        "SOLD_ABOVE_LIST": "0.35",
        "PRICE_DROPS": "0.10",
        "OFF_MARKET_IN_TWO_WEEKS": "0.20",
        "LAST_UPDATED": "2026-09-01 00:00:00",
        "PARENT_METRO_REGION": "Houston, TX",
        "PARENT_METRO_REGION_METRO_CODE": "26420",
    }
    base.update(overrides)
    return [base[c] for c in HEADER]


def _write_gz(path: Path, rows: list[list[str]], header: list[str] = HEADER) -> None:
    lines = ["\t".join(header)]
    lines += ["\t".join(r) for r in rows]
    text = "\n".join(lines) + "\n"
    path.write_bytes(gzip.compress(text.encode("utf-8")))


def test_filter_keeps_matching_rows_and_renames_columns(tmp_path):
    rows = [
        _row(),  # Houston, matches all filters -> kept
        _row(REGION="Atlanta, GA metro area", PARENT_METRO_REGION_METRO_CODE="12060"),  # kept
        _row(PROPERTY_TYPE="Townhouse"),  # wrong property type -> dropped
        _row(PERIOD_DURATION="90"),  # wrong duration -> dropped
        _row(IS_SEASONALLY_ADJUSTED="t"),  # seasonally adjusted -> dropped
        _row(REGION_TYPE="place"),  # wrong region type -> dropped
    ]
    gz_path = tmp_path / "redfin_metro.tsv.gz"
    out_path = tmp_path / "redfin_metro.parquet"
    _write_gz(gz_path, rows)

    data_through = _filter_to_parquet(
        gz_path, out_path, region_type="metro", history_months=36, tracked_regions=None
    )

    assert data_through == "2026-08-31"
    df = pl.read_parquet(out_path)
    assert df.height == 2
    assert set(df["region"]) == {"Houston, TX metro area", "Atlanta, GA metro area"}
    # renamed per COLUMN_RENAME
    for renamed in COLUMN_RENAME.values():
        assert renamed in df.columns
    houston = df.filter(pl.col("region") == "Houston, TX metro area").row(0, named=True)
    assert houston["median_sale_price"] == 350000
    assert houston["homes_sold"] == 1200


def test_filter_committed_fixture_tsv_keeps_only_matching_rows(tmp_path):
    # tests/fixtures/real_estate/redfin_metro_sample.tsv.gz: 3 metros x
    # All Residential/30-day/NSA (kept), plus rows covering other property
    # types, durations, seasonal adjustment, and region types (all dropped).
    gz_path = FIXTURES_DIR / "redfin_metro_sample.tsv.gz"
    out_path = tmp_path / "redfin_metro.parquet"

    _filter_to_parquet(gz_path, out_path, region_type="metro", history_months=36, tracked_regions=None)

    df = pl.read_parquet(out_path)
    assert df.height == 3
    assert set(df["region"]) == {
        "Houston, TX metro area",
        "Atlanta, GA metro area",
        "Denver, CO metro area",
    }


def test_filter_respects_tracked_regions(tmp_path):
    rows = [
        _row(),  # Houston
        _row(REGION="Atlanta, GA metro area"),
    ]
    gz_path = tmp_path / "redfin_metro.tsv.gz"
    out_path = tmp_path / "redfin_metro.parquet"
    _write_gz(gz_path, rows)

    _filter_to_parquet(
        gz_path,
        out_path,
        region_type="metro",
        history_months=36,
        tracked_regions={"Houston, TX metro area"},
    )

    df = pl.read_parquet(out_path)
    assert df.height == 1
    assert df["region"][0] == "Houston, TX metro area"


def test_filter_drops_rows_older_than_history_window(tmp_path):
    rows = [
        _row(),  # recent, kept
        _row(PERIOD_BEGIN="2015-01-01", PERIOD_END="2015-01-31"),  # far too old
    ]
    gz_path = tmp_path / "redfin_metro.tsv.gz"
    out_path = tmp_path / "redfin_metro.parquet"
    _write_gz(gz_path, rows)

    _filter_to_parquet(gz_path, out_path, region_type="metro", history_months=6, tracked_regions=None)

    df = pl.read_parquet(out_path)
    assert df.height == 1
    assert str(df["period_end"][0]) == "2026-08-31"


def test_filter_national_region_type(tmp_path):
    rows = [_row(REGION_TYPE="national", REGION="United States")]
    gz_path = tmp_path / "us_national.tsv.gz"
    out_path = tmp_path / "redfin_national.parquet"
    _write_gz(gz_path, rows)

    _filter_to_parquet(gz_path, out_path, region_type="national", history_months=36, tracked_regions=None)

    df = pl.read_parquet(out_path)
    assert df.height == 1
    assert df["region"][0] == "United States"


def test_filter_raises_when_required_column_missing(tmp_path):
    header = [c for c in HEADER if c != "MEDIAN_SALE_PRICE"]
    rows = [[v for c, v in zip(HEADER, _row(), strict=True) if c != "MEDIAN_SALE_PRICE"]]
    gz_path = tmp_path / "redfin_metro.tsv.gz"
    out_path = tmp_path / "redfin_metro.parquet"
    _write_gz(gz_path, rows, header=header)

    with pytest.raises(RedfinColumnsMissing):
        _filter_to_parquet(gz_path, out_path, region_type="metro", history_months=36, tracked_regions=None)


def test_filter_deletes_decompressed_tsv_after_success(tmp_path):
    gz_path = tmp_path / "redfin_metro.tsv.gz"
    out_path = tmp_path / "redfin_metro.parquet"
    _write_gz(gz_path, [_row()])

    _filter_to_parquet(gz_path, out_path, region_type="metro", history_months=36, tracked_regions=None)

    assert not gz_path.with_suffix("").exists()


@respx.mock
def test_metro_download_uses_agents_core_conditional_get(tmp_path, monkeypatch):
    """The Redfin file goes through agents-core's `Http.download`: a 200 then a 304
    (sent with the first response's ETag/Last-Modified) that leaves the file as is."""
    dest = tmp_path / "cache" / "redfin_metro_market_tracker.tsv.gz"
    monkeypatch.setattr(fetch_redfin, "METRO_GZ_PATH", dest)
    route = respx.get(fetch_redfin.LEGACY_METRO_URL).mock(
        return_value=httpx.Response(
            200,
            content=b"some,gzipped,bytes",
            headers={"ETag": '"abc123"', "Last-Modified": "Wed, 01 Sep 2026 00:00:00 GMT"},
        )
    )
    with Http(cache_dir=tmp_path / "http_cache") as http:
        first = fetch_redfin.download_metro_file(http)
        assert first.modified is True and first.etag == '"abc123"'
        route.mock(return_value=httpx.Response(304))
        second = fetch_redfin.download_metro_file(http)
    assert second.modified is False
    assert route.calls.last.request.headers["If-None-Match"] == '"abc123"'
    assert dest.read_bytes() == b"some,gzipped,bytes"


# --- Redfin Data Center (2026 format) ----------------------------------------------

from datetime import date as _date  # noqa: E402

from agents.real_estate.config import load_metros  # noqa: E402
from agents.real_estate.fetch_redfin import PARQUET_COLUMNS, dc_frame  # noqa: E402
from tests import redfin_dc_fixtures as dc  # noqa: E402

MONTHS = [_date(2026, m, [31, 28, 31, 30, 31, 30, 31, 31][m - 1]) for m in range(1, 9)]
TODAY = _date(2026, 9, 28)


def _write(tmp_path, name: str, body: bytes):
    path = tmp_path / name
    path.write_bytes(body)
    return path


def test_dc_frame_converts_percents_and_joins_price_drops_by_name(tmp_path):
    housing = _write(tmp_path, "h.csv", dc.housing_csv([
        ("Houston, TX metro area", "26420", "Metro", dc.default_values(340000)),
        ("Dallas, TX metro area", "19124", "Metro", dc.default_values(420000)),
    ], MONTHS))  # fmt: skip
    drops = _write(tmp_path, "d.csv", dc.price_drops_csv([("Houston, TX metro area", "Metro", 24.68)], MONTHS))
    frame = dc_frame(housing, drops, region_type="metro", history_months=36, tracked_regions=None, today=TODAY)
    assert frame.columns == list(PARQUET_COLUMNS)
    houston = frame.filter(pl.col("region") == "Houston, TX metro area").sort("period_end")
    assert houston.height == 8
    last = houston.row(-1, named=True)
    assert last["period_end"] == _date(2026, 8, 31)
    assert last["avg_sale_to_list"] == pytest.approx(0.98)
    assert last["sold_above_list"] == pytest.approx(0.30)
    assert last["off_market_in_two_weeks"] == pytest.approx(0.20)
    assert last["price_drops"] == pytest.approx(0.2468)
    assert last["median_sale_price"] == pytest.approx(round(340000 * 1.028))
    assert last["redfin_metro_code"] == "26420"
    # No price-drop row for Dallas: null, not a failure.
    assert frame.filter(pl.col("region") == "Dallas, TX metro area")["price_drops"].null_count() == 8


def test_dc_frame_filters_region_type_tracked_regions_and_history(tmp_path):
    housing = _write(tmp_path, "h.csv", dc.housing_csv([
        ("Houston, TX metro area", "26420", "Metro", dc.default_values(340000)),
        ("Austin, TX metro area", "12420", "Metro", dc.default_values(440000)),
        ("National", None, "Country", dc.default_values(400000)),
    ], MONTHS))  # fmt: skip
    metros = dc_frame(housing, None, region_type="metro", history_months=36, tracked_regions={"Austin, TX metro area"}, today=TODAY)
    assert metros["region"].unique().to_list() == ["Austin, TX metro area"]
    assert metros["price_drops"].null_count() == metros.height
    national = dc_frame(housing, None, region_type="country", history_months=36, tracked_regions=None, today=TODAY)
    assert national["region"].unique().to_list() == ["National"]
    recent = dc_frame(housing, None, region_type="country", history_months=3, tracked_regions=None, today=TODAY)
    assert recent["period_end"].min() >= _date(2026, 5, 1)


def test_dc_frame_skips_non_monthly_rows_and_nulls(tmp_path):
    body = dc.housing_csv([("Houston, TX metro area", "26420", "Metro", {**dc.default_values(340000), "MONTHS OF SUPPLY": None})], MONTHS)
    body = body.replace(b'"Monthly","2026-08-01"', b'"Four Weeks","2026-08-01"')
    frame = dc_frame(_write(tmp_path, "h.csv", body), None, region_type="metro", history_months=36, tracked_regions=None, today=TODAY)
    assert frame["period_end"].max() == _date(2026, 7, 31)
    assert frame["months_of_supply"].null_count() == frame.height


def test_dc_frame_raises_when_a_required_column_is_missing(tmp_path):
    body = dc.housing_csv([("Houston, TX metro area", "26420", "Metro", dc.default_values(340000))], MONTHS)
    body = body.replace(b'"INVENTORY",', b'"STOCK",', 1)
    with pytest.raises(RedfinColumnsMissing, match="INVENTORY"):
        dc_frame(_write(tmp_path, "h.csv", body), None, region_type="metro", history_months=36, tracked_regions=None, today=TODAY)


def _names(fixture: str) -> set[str]:
    lines = (FIXTURES_DIR / fixture).read_text().splitlines()
    return {line for line in lines if line and not line.startswith("#")}


def test_every_tracked_metro_matches_the_live_data_center_names():
    """Price drops have no REGION ID, so the join is by name: every metro in
    config/metros.toml must appear verbatim in both live files (snapshot 2026-09-28;
    `scripts/verify_re_sources.py` re-checks against the live files)."""
    metros = load_metros()
    assert len(metros) == 50
    housing, drops = _names("redfin_dc_metro_names.txt"), _names("redfin_dc_price_drop_metro_names.txt")
    assert [m.redfin_region for m in metros if m.redfin_region not in housing] == []
    assert [m.redfin_region for m in metros if m.redfin_region not in drops] == []
