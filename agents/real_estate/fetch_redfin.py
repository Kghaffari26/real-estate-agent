"""Fetch Redfin's public metro-level and national market tracker files.

Redfin publishes both as gzipped TSV. The metro file is large (~110MB
compressed, hundreds of MB uncompressed), so this module always does a
conditional GET (a 304 skips reprocessing entirely) and reads the
decompressed file lazily with polars, filtering down to a small parquet
before anything else touches it. The decompressed TSV is deleted as soon
as the parquet is written.

Column names and values below (REGION_TYPE == "metro"/"national",
IS_SEASONALLY_ADJUSTED as a bare true/false) were confirmed against a live
pull of both files from the Redfin Data Center.

`PARENT_METRO_REGION_METRO_CODE` is carried through as `redfin_metro_code`
— it is Redfin's own internal metro identifier, close to but *not* the OMB
CBSA code (confirmed against known CBSA codes: Redfin gives Chicago
16984 vs. the real CBSA 16980, Los Angeles 31084 vs. 31080, New York
35614 vs. 35620). Never join it against Census or ACS data as if it were
a CBSA code; `config/metros.toml`'s hand-reviewed `cbsa` field is the only
trustworthy CBSA source in this codebase.
"""

from __future__ import annotations

import gzip
import shutil
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import polars as pl
from agents_core.http import HTTPClient

METRO_URL = (
    "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/"
    "redfin_metro_market_tracker.tsv000.gz"
)
NATIONAL_URL = (
    "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/"
    "us_national_market_tracker.tsv000.gz"
)

CACHE_DIR = Path("data/cache/real_estate")
METRO_GZ_PATH = CACHE_DIR / "redfin_metro_market_tracker.tsv.gz"
NATIONAL_GZ_PATH = CACHE_DIR / "us_national_market_tracker.tsv.gz"
METRO_PARQUET_PATH = CACHE_DIR / "redfin_metro.parquet"
NATIONAL_PARQUET_PATH = CACHE_DIR / "redfin_national.parquet"

# Columns SPEC_REAL_ESTATE.md §3.1 requires us to assert exist and fail
# loudly on if missing (beyond the ones needed only for filtering).
REQUIRED_DATA_COLUMNS: tuple[str, ...] = (
    "PERIOD_BEGIN",
    "PERIOD_END",
    "REGION",
    "STATE_CODE",
    "TABLE_ID",
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
)
REQUIRED_FILTER_COLUMNS: tuple[str, ...] = (
    "REGION_TYPE",
    "PROPERTY_TYPE",
    "PERIOD_DURATION",
    "IS_SEASONALLY_ADJUSTED",
)
# Present in the live files but not asserted by the spec; carried through
# for `scripts/build_metro_config.py` (see module docstring re: this NOT
# being the OMB CBSA code, despite the name).
OPTIONAL_COLUMNS: tuple[str, ...] = ("PARENT_METRO_REGION", "PARENT_METRO_REGION_METRO_CODE")

COLUMN_RENAME: dict[str, str] = {
    "PERIOD_BEGIN": "period_begin",
    "PERIOD_END": "period_end",
    "REGION": "region",
    "STATE_CODE": "state_code",
    "TABLE_ID": "table_id",
    "MEDIAN_SALE_PRICE": "median_sale_price",
    "HOMES_SOLD": "homes_sold",
    "NEW_LISTINGS": "new_listings",
    "INVENTORY": "inventory",
    "MONTHS_OF_SUPPLY": "months_of_supply",
    "MEDIAN_DOM": "median_dom",
    "AVG_SALE_TO_LIST": "avg_sale_to_list",
    "SOLD_ABOVE_LIST": "sold_above_list",
    "PRICE_DROPS": "price_drops",
    "OFF_MARKET_IN_TWO_WEEKS": "off_market_in_two_weeks",
    "LAST_UPDATED": "last_updated",
    "PARENT_METRO_REGION": "parent_metro_region",
    "PARENT_METRO_REGION_METRO_CODE": "redfin_metro_code",
}


class RedfinColumnsMissing(RuntimeError):
    """A required Redfin column is missing or was renamed upstream."""


@dataclass
class FetchResult:
    modified: bool
    parquet_path: Path
    data_through: str | None  # ISO date of the latest PERIOD_END, if known


def download_metro_file(client: HTTPClient, force: bool = False):
    return client.download(METRO_URL, METRO_GZ_PATH, force=force)


def download_national_file(client: HTTPClient, force: bool = False):
    return client.download(NATIONAL_URL, NATIONAL_GZ_PATH, force=force)


def _assert_columns(columns: list[str]) -> None:
    have = set(columns)
    missing = [c for c in (*REQUIRED_DATA_COLUMNS, *REQUIRED_FILTER_COLUMNS) if c not in have]
    if missing:
        raise RedfinColumnsMissing(f"Redfin file is missing expected columns: {missing}")


def _not_seasonally_adjusted(colname: str) -> pl.Expr:
    """Redfin encodes this as a bare `true`/`false` (usually inferred as
    Boolean by polars), but be defensive: cast to string first so a `t`/`f`
    or `0`/`1` encoding from a future export still works."""
    return pl.col(colname).cast(pl.Utf8, strict=False).str.to_lowercase().is_in(["false", "f", "0"])


def _region_type_filter(region_type: str) -> pl.Expr:
    return pl.col("REGION_TYPE").cast(pl.Utf8, strict=False).str.to_lowercase() == region_type


def _decompress(gz_path: Path) -> Path:
    tsv_path = gz_path.with_suffix("")  # strip the trailing .gz
    with gzip.open(gz_path, "rb") as f_in, open(tsv_path, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    return tsv_path


def _filter_to_parquet(
    gz_path: Path,
    out_path: Path,
    *,
    region_type: str,
    history_months: int,
    tracked_regions: set[str] | None,
) -> str | None:
    """Decompress `gz_path`, filter per SPEC §3.1, write `out_path`, and
    return the latest `period_end` found (as an ISO date string), or None
    if the result is empty."""
    tsv_path = _decompress(gz_path)
    try:
        lf = pl.scan_csv(
            tsv_path,
            separator="\t",
            infer_schema_length=10000,
            try_parse_dates=True,
            null_values=["NA"],
            schema_overrides={"LAST_UPDATED": pl.Utf8},
        )
        schema_columns = lf.collect_schema().names()
        _assert_columns(schema_columns)

        cutoff = date.today() - timedelta(days=int(history_months * 30.44) + 31)
        filters = (
            _region_type_filter(region_type)
            & (pl.col("PROPERTY_TYPE") == "All Residential")
            & (pl.col("PERIOD_DURATION") == 30)
            & _not_seasonally_adjusted("IS_SEASONALLY_ADJUSTED")
            & (pl.col("PERIOD_END") >= cutoff)
        )
        if tracked_regions is not None:
            filters = filters & pl.col("REGION").is_in(sorted(tracked_regions))

        select_cols = [c for c in (*REQUIRED_DATA_COLUMNS, *OPTIONAL_COLUMNS) if c in schema_columns]
        filtered = lf.filter(filters).select(select_cols).rename(
            {k: v for k, v in COLUMN_RENAME.items() if k in select_cols}
        )
        # Write to a temp path and rename on success: a mid-write failure
        # (e.g. a schema surprise) must never leave a corrupt or partial
        # file at `out_path`, since callers treat its mere existence as a
        # valid cache to skip reprocessing on the next run.
        tmp_out = out_path.with_name(out_path.name + ".tmp")
        filtered.sink_parquet(tmp_out)
        tmp_out.replace(out_path)
    finally:
        tsv_path.unlink(missing_ok=True)

    result = pl.scan_parquet(out_path).select(pl.col("period_end").max()).collect()
    if result.is_empty() or result[0, 0] is None:
        return None
    return str(result[0, 0])


def fetch_metro(
    client: HTTPClient,
    *,
    tracked_regions: set[str] | None = None,
    history_months: int = 36,
    force: bool = False,
) -> FetchResult:
    dl = download_metro_file(client, force=force)
    if not dl.modified and METRO_PARQUET_PATH.exists():
        data_through = (
            pl.scan_parquet(METRO_PARQUET_PATH).select(pl.col("period_end").max()).collect()[0, 0]
        )
        return FetchResult(modified=False, parquet_path=METRO_PARQUET_PATH, data_through=str(data_through))
    data_through = _filter_to_parquet(
        METRO_GZ_PATH,
        METRO_PARQUET_PATH,
        region_type="metro",
        history_months=history_months,
        tracked_regions=tracked_regions,
    )
    return FetchResult(modified=True, parquet_path=METRO_PARQUET_PATH, data_through=data_through)


def fetch_national(
    client: HTTPClient,
    *,
    history_months: int = 36,
    force: bool = False,
) -> FetchResult:
    dl = download_national_file(client, force=force)
    if not dl.modified and NATIONAL_PARQUET_PATH.exists():
        data_through = (
            pl.scan_parquet(NATIONAL_PARQUET_PATH).select(pl.col("period_end").max()).collect()[0, 0]
        )
        return FetchResult(modified=False, parquet_path=NATIONAL_PARQUET_PATH, data_through=str(data_through))
    data_through = _filter_to_parquet(
        NATIONAL_GZ_PATH,
        NATIONAL_PARQUET_PATH,
        region_type="national",
        history_months=history_months,
        tracked_regions=None,
    )
    return FetchResult(modified=True, parquet_path=NATIONAL_PARQUET_PATH, data_through=data_through)


def top_metros_by_homes_sold(gz_path: Path, n: int = 50, trailing_months: int = 12) -> pl.DataFrame:
    """Used only by `scripts/build_metro_config.py`: rank metros by total
    homes sold over the trailing `trailing_months`, from the *unfiltered*
    all-residential, monthly, NSA rows (no `tracked_regions` restriction,
    since this is how the tracked set gets picked in the first place)."""
    tsv_path = _decompress(gz_path)
    try:
        lf = pl.scan_csv(
            tsv_path,
            separator="\t",
            infer_schema_length=10000,
            try_parse_dates=True,
            null_values=["NA"],
            schema_overrides={"LAST_UPDATED": pl.Utf8},
        )
        schema_columns = lf.collect_schema().names()
        _assert_columns(schema_columns)
        cutoff = date.today() - timedelta(days=int(trailing_months * 30.44) + 31)
        select_cols = [c for c in (*REQUIRED_DATA_COLUMNS, *OPTIONAL_COLUMNS) if c in schema_columns]
        filtered = (
            lf.filter(
                _region_type_filter("metro")
                & (pl.col("PROPERTY_TYPE") == "All Residential")
                & (pl.col("PERIOD_DURATION") == 30)
                & _not_seasonally_adjusted("IS_SEASONALLY_ADJUSTED")
                & (pl.col("PERIOD_END") >= cutoff)
            )
            .select(select_cols)
            .rename({k: v for k, v in COLUMN_RENAME.items() if k in select_cols})
        )
        has_code = "PARENT_METRO_REGION_METRO_CODE" in select_cols
        has_parent_region = "PARENT_METRO_REGION" in select_cols
        ranked = (
            filtered.group_by("region")
            .agg(
                pl.col("homes_sold").sum().alias("homes_sold_12m"),
                pl.col("state_code").first(),
                pl.col("redfin_metro_code").first() if has_code else pl.lit(None).alias("redfin_metro_code"),
                pl.col("parent_metro_region").first() if has_parent_region else pl.lit(None).alias("parent_metro_region"),
            )
            .sort("homes_sold_12m", descending=True)
            .head(n)
            .collect()
        )
        return ranked
    finally:
        tsv_path.unlink(missing_ok=True)
