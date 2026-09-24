from __future__ import annotations

import gzip
from pathlib import Path

import httpx
import polars as pl
import pytest
import respx

from agents.real_estate.fetch_redfin import (
    COLUMN_RENAME,
    RedfinColumnsMissing,
    _filter_to_parquet,
)
from core.http import HTTPClient

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
def test_download_reports_modified_true_on_200_then_false_on_304(tmp_path):
    url = "https://example.com/redfin_metro_market_tracker.tsv000.gz"
    dest = tmp_path / "cache" / "redfin_metro_market_tracker.tsv.gz"

    respx.get(url).mock(
        return_value=httpx.Response(
            200,
            content=b"some,gzipped,bytes",
            headers={"ETag": '"abc123"', "Last-Modified": "Wed, 01 Sep 2026 00:00:00 GMT"},
        )
    )
    with HTTPClient(cache_dir=tmp_path / "http_cache") as client:
        first = client.download(url, dest)
        assert first.modified is True
        assert first.status_code == 200
        assert first.etag == '"abc123"'
        assert dest.read_bytes() == b"some,gzipped,bytes"

        respx.get(url).mock(return_value=httpx.Response(304))
        second = client.download(url, dest)
        assert second.modified is False
        assert second.status_code == 304
        # dest untouched, still has the original content and the etag carries over
        assert dest.read_bytes() == b"some,gzipped,bytes"
        assert second.etag == '"abc123"'
