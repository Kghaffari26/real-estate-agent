"""Fetch Zillow Research's metro ZHVI and ZORI CSVs.

Both are wide CSVs: one row per region (keyed by Zillow's `RegionID`), one
column per month (`YYYY-MM-DD`). Small enough for a plain cached download
(no conditional-GET bookkeeping needed, unlike the much larger Redfin
file). This module melts them to long format and keeps only the tracked
RegionIDs and the trailing `history_months` months.
"""

from __future__ import annotations

import re
from pathlib import Path

import polars as pl

from core.http import HTTPClient

ZHVI_URL = (
    "https://files.zillowstatic.com/research/public_csvs/zhvi/"
    "Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
)
ZORI_URL = "https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv"

CACHE_DIR = Path("data/cache/real_estate")
ZHVI_CSV_PATH = CACHE_DIR / "zillow_zhvi.csv"
ZORI_CSV_PATH = CACHE_DIR / "zillow_zori.csv"

_DATE_COLUMN_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ZillowFormatError(RuntimeError):
    """The CSV doesn't look like a Zillow Research wide export."""


def download_zhvi(client: HTTPClient, force: bool = False):
    return client.download(ZHVI_URL, ZHVI_CSV_PATH, force=force)


def download_zori(client: HTTPClient, force: bool = False):
    return client.download(ZORI_URL, ZORI_CSV_PATH, force=force)


def load_long(
    csv_path: Path,
    value_name: str,
    region_ids: set[int] | None = None,
    history_months: int = 40,
) -> pl.DataFrame:
    """Melt a Zillow wide CSV to long format: one row per (RegionID, date)."""
    df = pl.read_csv(csv_path, infer_schema_length=10000)
    if "RegionID" not in df.columns:
        raise ZillowFormatError(f"{csv_path}: missing the RegionID column")

    date_cols = sorted(c for c in df.columns if _DATE_COLUMN_RE.match(c))
    if not date_cols:
        raise ZillowFormatError(f"{csv_path}: no YYYY-MM-DD month columns found")
    date_cols = date_cols[-history_months:]

    if region_ids is not None:
        df = df.filter(pl.col("RegionID").is_in(sorted(region_ids)))

    long = df.select(["RegionID", *date_cols]).unpivot(
        on=date_cols, index="RegionID", variable_name="date", value_name=value_name
    )
    long = long.with_columns(pl.col("date").str.to_date())
    return long.rename({"RegionID": "zillow_region_id"})
