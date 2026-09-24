from __future__ import annotations

from datetime import date

import pytest

from agents.real_estate.fetch_zillow import ZillowFormatError, load_long

WIDE_CSV = """RegionID,RegionName,2026-06-30,2026-07-31,2026-08-31
1,"Houston, TX",300000,301000,302500
2,"Atlanta, GA",275000,276500,278000
3,"Denver, CO",450000,451000,452000
"""


def _write(tmp_path, text: str = WIDE_CSV):
    path = tmp_path / "zillow_zhvi.csv"
    path.write_text(text)
    return path


def test_load_long_melts_wide_to_long(tmp_path):
    path = _write(tmp_path)
    long = load_long(path, value_name="zhvi", region_ids=None, history_months=40)

    assert set(long.columns) == {"zillow_region_id", "date", "zhvi"}
    assert long.height == 9  # 3 regions * 3 month columns
    houston_aug = long.filter(
        (long["zillow_region_id"] == 1) & (long["date"] == date(2026, 8, 31))
    )
    assert houston_aug["zhvi"][0] == 302500


def test_load_long_filters_by_region_ids(tmp_path):
    path = _write(tmp_path)
    long = load_long(path, value_name="zhvi", region_ids={1, 3}, history_months=40)

    assert set(long["zillow_region_id"].unique()) == {1, 3}
    assert long.height == 6


def test_load_long_truncates_to_trailing_history_months(tmp_path):
    path = _write(tmp_path)
    long = load_long(path, value_name="zhvi", region_ids=None, history_months=2)

    dates = sorted(long["date"].unique())
    assert dates == [date(2026, 7, 31), date(2026, 8, 31)]
    assert long.height == 6  # 3 regions * 2 months


def test_load_long_raises_zillow_format_error_without_region_id(tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text("RegionName,2026-06-30\nHouston,300000\n")

    with pytest.raises(ZillowFormatError):
        load_long(path, value_name="zhvi")


def test_load_long_raises_zillow_format_error_without_date_columns(tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text("RegionID,RegionName\n1,Houston\n")

    with pytest.raises(ZillowFormatError):
        load_long(path, value_name="zhvi")


def test_load_long_renames_value_column(tmp_path):
    path = _write(tmp_path)
    long = load_long(path, value_name="zori", region_ids={2}, history_months=1)

    assert "zori" in long.columns
    assert long.height == 1
    assert long["zori"][0] == 278000
