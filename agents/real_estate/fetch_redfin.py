"""Fetch Redfin's public metro-level and national market data.

**Primary source (since 2026-09): the relaunched Redfin Data Center**, CSV files in
the same public bucket under `redfin_data_center/` (manifest: `index.json`):

- `housing_market/monthly/all_metros.csv` and `.../country.csv`: one row per region
  and month back to 2012, with value/MOM/YOY triplets. Percent columns are percents
  (97.09, not 0.9709) and their MOM/YOY are in points. We keep only the values,
  convert percents to ratios, and compute YoY/MoM ourselves (`compute.py`), exactly
  as for the old files. `all_metros` rather than `top_50_metros`, because Redfin's
  top 50 omits 5 tracked metros (North Port, Raleigh, Oklahoma City, Cape Coral,
  Myrtle Beach).
- `price_drops/monthly/all_metros.csv` and `.../country.csv`: `PERCENT ACTIVE WITH
  PRICE DROPS (%)` becomes `price_drops`. These files have REGION NAME but no REGION
  ID, so they are joined on (region name, period end); every tracked metro's
  `redfin_region` matches exactly (tested against a snapshot of the live names).

The new files are a new methodology, not a continuation: e.g. May 2026 national
median sale price is $399,900 here vs $449,846 in the old export, "sold above list"
is now above the *original* list price, and the price-drop share is of active
listings. Every series therefore comes from one source; old and new are never
spliced.

**Fallback: the legacy market tracker** (`redfin_market_tracker/*.tsv000.gz`, gzipped
TSV), which Redfin stopped updating on 2026-06-02 (data through May 2026). It's used
only when the Data Center files can't be fetched or parsed, with a warning. The
notes below describe that format.

The legacy files are gzipped TSV. The metro file is large (~110MB
compressed, hundreds of MB uncompressed), so this module always does a
conditional GET (a 304 skips reprocessing entirely) and reads the
decompressed file lazily with polars, filtering down to a small parquet
before anything else touches it. The decompressed TSV is deleted as soon
as the parquet is written.

Column names and values below (REGION_TYPE == "metro"/"national",
IS_SEASONALLY_ADJUSTED as a bare true/false) were confirmed against a live
pull of both files from the Redfin Data Center.

`PARENT_METRO_REGION_METRO_CODE` is carried through as `redfin_metro_code`
— it is often the OMB CBSA code, but for Redfin's metro *divisions* it's the
division code (Chicago 16984 in CBSA 16980, Los Angeles 31084 in 31080, New
York 35614 in 35620), and some are pre-2023 codes (Cleveland 17460, now
17410). Never join it against Census or ACS data as if it were a CBSA code;
`config/metros.toml`'s `cbsa` field (Census Gazetteer name match, see
`scripts/build_metro_config.py`) is the only trustworthy CBSA source here.
"""

from __future__ import annotations

import gzip
import shutil
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import polars as pl
from agents_core.http import DownloadResult, Http

BUCKET = "https://redfin-public-data.s3.us-west-2.amazonaws.com"
DATA_CENTER_BASE = f"{BUCKET}/redfin_data_center"
METRO_URL = f"{DATA_CENTER_BASE}/housing_market/monthly/all_metros.csv"
NATIONAL_URL = f"{DATA_CENTER_BASE}/housing_market/monthly/country.csv"
PRICE_DROPS_METRO_URL = f"{DATA_CENTER_BASE}/price_drops/monthly/all_metros.csv"
PRICE_DROPS_NATIONAL_URL = f"{DATA_CENTER_BASE}/price_drops/monthly/country.csv"

# Legacy exports: frozen since 2026-06-02 (data through May 2026). Fallback only.
LEGACY_METRO_URL = f"{BUCKET}/redfin_market_tracker/redfin_metro_market_tracker.tsv000.gz"
LEGACY_NATIONAL_URL = f"{BUCKET}/redfin_market_tracker/us_national_market_tracker.tsv000.gz"

CACHE_DIR = Path("data/cache/real_estate")
DC_METRO_CSV_PATH = CACHE_DIR / "redfin_dc_metro.csv"
DC_NATIONAL_CSV_PATH = CACHE_DIR / "redfin_dc_national.csv"
DC_PRICE_DROPS_METRO_CSV_PATH = CACHE_DIR / "redfin_dc_price_drops_metro.csv"
DC_PRICE_DROPS_NATIONAL_CSV_PATH = CACHE_DIR / "redfin_dc_price_drops_national.csv"
DC_METRO_PARQUET_PATH = CACHE_DIR / "redfin_dc_metro.parquet"
DC_NATIONAL_PARQUET_PATH = CACHE_DIR / "redfin_dc_national.parquet"
# Long monthly history (§6.4 timelines): the same metro CSVs, from TIMELINE_SINCE on.
DC_METRO_TIMELINE_PARQUET_PATH = CACHE_DIR / "redfin_dc_metro_timeline.parquet"
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
    source: str = "data_center"  # or "legacy"
    urls: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()


def download_metro_file(http: Http, force: bool = False) -> DownloadResult:
    """The legacy metro TSV (also used by scripts/build_metro_config.py)."""
    return http.download(LEGACY_METRO_URL, METRO_GZ_PATH, force=force)


def download_national_file(http: Http, force: bool = False) -> DownloadResult:
    return http.download(LEGACY_NATIONAL_URL, NATIONAL_GZ_PATH, force=force)


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


def fetch_metro_legacy(
    http: Http,
    *,
    tracked_regions: set[str] | None = None,
    history_months: int = 36,
    force: bool = False,
) -> FetchResult:
    dl = download_metro_file(http, force=force)
    if not dl.modified and METRO_PARQUET_PATH.exists():
        data_through = (
            pl.scan_parquet(METRO_PARQUET_PATH).select(pl.col("period_end").max()).collect()[0, 0]
        )
        return FetchResult(modified=False, parquet_path=METRO_PARQUET_PATH, data_through=str(data_through), source="legacy", urls=(LEGACY_METRO_URL,))
    data_through = _filter_to_parquet(
        METRO_GZ_PATH,
        METRO_PARQUET_PATH,
        region_type="metro",
        history_months=history_months,
        tracked_regions=tracked_regions,
    )
    return FetchResult(modified=True, parquet_path=METRO_PARQUET_PATH, data_through=data_through, source="legacy", urls=(LEGACY_METRO_URL,))


def fetch_national_legacy(
    http: Http,
    *,
    history_months: int = 36,
    force: bool = False,
) -> FetchResult:
    dl = download_national_file(http, force=force)
    if not dl.modified and NATIONAL_PARQUET_PATH.exists():
        data_through = (
            pl.scan_parquet(NATIONAL_PARQUET_PATH).select(pl.col("period_end").max()).collect()[0, 0]
        )
        return FetchResult(modified=False, parquet_path=NATIONAL_PARQUET_PATH, data_through=str(data_through), source="legacy", urls=(LEGACY_NATIONAL_URL,))
    data_through = _filter_to_parquet(
        NATIONAL_GZ_PATH,
        NATIONAL_PARQUET_PATH,
        region_type="national",
        history_months=history_months,
        tracked_regions=None,
    )
    return FetchResult(modified=True, parquet_path=NATIONAL_PARQUET_PATH, data_through=data_through, source="legacy", urls=(LEGACY_NATIONAL_URL,))


# --- Redfin Data Center (primary) -------------------------------------------------

# Data Center column → our parquet column, and whether it's a percent to divide by 100.
DC_HOUSING_COLUMNS: dict[str, tuple[str, bool]] = {
    "MEDIAN SALE PRICE NSA ($)": ("median_sale_price", False),
    "HOMES SOLD": ("homes_sold", False),
    "NEW LISTINGS": ("new_listings", False),
    "INVENTORY": ("inventory", False),
    "MONTHS OF SUPPLY": ("months_of_supply", False),
    "MEDIAN DAYS ON MARKET (DAYS)": ("median_dom", False),
    "AVERAGE SALE TO LIST RATIO (%)": ("avg_sale_to_list", True),
    "SHARE SOLD ABOVE ORIGINAL LIST (%)": ("sold_above_list", True),
    "PERCENT OFF MARKET IN TWO WEEKS (%)": ("off_market_in_two_weeks", True),
}
DC_PRICE_DROPS_COLUMNS: dict[str, tuple[str, bool]] = {
    "PERCENT ACTIVE WITH PRICE DROPS (%)": ("price_drops", True),
}
DC_KEY_COLUMNS = ("FREQUENCY", "PERIOD BEGIN", "PERIOD END", "REGION TYPE", "REGION NAME", "LAST UPDATED")
# The housing files also carry REGION ID (same codes as the legacy export's
# PARENT_METRO_REGION_METRO_CODE); the price-drops files don't.
DC_HOUSING_KEY_COLUMNS = (*DC_KEY_COLUMNS, "REGION ID")
# The parquet schema every downstream module reads (same as the legacy parquet's
# data columns, so transform/compute don't know which source was used).
PARQUET_COLUMNS = (
    "period_begin", "period_end", "region", "median_sale_price", "homes_sold", "new_listings", "inventory",
    "months_of_supply", "median_dom", "avg_sale_to_list", "sold_above_list", "price_drops",
    "off_market_in_two_weeks", "last_updated", "redfin_metro_code",
)  # fmt: skip


def _scan_dc_csv(path: Path, required: tuple[str, ...]) -> pl.LazyFrame:
    lf = pl.scan_csv(path, infer_schema_length=0, null_values=["NA", ""])  # all Utf8; cast explicitly
    columns = lf.collect_schema().names()
    missing = [c for c in required if c not in columns]
    if missing:
        raise RedfinColumnsMissing(f"Redfin Data Center file {path.name} is missing expected columns: {missing}")
    return lf


def _dc_values(mapping: dict[str, tuple[str, bool]]) -> list[pl.Expr]:
    exprs = []
    for source, (target, is_percent) in mapping.items():
        value = pl.col(source).cast(pl.Float64, strict=False)
        exprs.append((value / 100 if is_percent else value).alias(target))
    return exprs


def dc_frame(
    housing_csv: Path,
    price_drops_csv: Path | None,
    *,
    region_type: str,
    history_months: int,
    tracked_regions: set[str] | None,
    today: date | None = None,
    since: date | None = None,
) -> pl.DataFrame:
    """Normalize Data Center CSVs to the parquet schema: monthly rows of one region
    type, percents → ratios, the price-drop share joined on (region name, period end).
    `since` (a first period end) replaces the `history_months` window when given."""
    cutoff = since or (today or date.today()) - timedelta(days=int(history_months * 30.44) + 31)

    def base_filter(lf: pl.LazyFrame) -> pl.LazyFrame:
        lf = lf.with_columns(pl.col("PERIOD END").str.to_date("%Y-%m-%d", strict=False).alias("_end"))
        cond = (
            (pl.col("REGION TYPE").str.to_lowercase() == region_type)
            & (pl.col("FREQUENCY").str.to_lowercase() == "monthly")
            & (pl.col("_end") >= cutoff)
        )
        if tracked_regions is not None:
            cond = cond & pl.col("REGION NAME").is_in(sorted(tracked_regions))
        return lf.filter(cond)

    housing = base_filter(_scan_dc_csv(housing_csv, (*DC_HOUSING_KEY_COLUMNS, *DC_HOUSING_COLUMNS))).select(
        pl.col("PERIOD BEGIN").str.to_date("%Y-%m-%d", strict=False).alias("period_begin"),
        pl.col("_end").alias("period_end"),
        pl.col("REGION NAME").alias("region"),
        *_dc_values(DC_HOUSING_COLUMNS),
        pl.col("LAST UPDATED").alias("last_updated"),
        pl.col("REGION ID").cast(pl.Utf8).alias("redfin_metro_code"),
    )
    if price_drops_csv is not None:
        drops = base_filter(_scan_dc_csv(price_drops_csv, (*DC_KEY_COLUMNS, *DC_PRICE_DROPS_COLUMNS))).select(
            pl.col("REGION NAME").alias("region"),
            pl.col("_end").alias("period_end"),
            *_dc_values(DC_PRICE_DROPS_COLUMNS),
        )
        frame = housing.join(drops.unique(["region", "period_end"], keep="last"), on=["region", "period_end"], how="left")
    else:
        frame = housing.with_columns(pl.lit(None, dtype=pl.Float64).alias("price_drops"))
    return frame.select(PARQUET_COLUMNS).unique(["region", "period_end"], keep="last").sort(["region", "period_end"]).collect()


def _write_parquet(frame: pl.DataFrame, out_path: Path) -> str | None:
    tmp = out_path.with_name(out_path.name + ".tmp")
    frame.write_parquet(tmp)
    tmp.replace(out_path)
    latest = frame.select(pl.col("period_end").max())[0, 0] if frame.height else None
    return str(latest) if latest is not None else None


def _fetch_dc(
    http: Http,
    *,
    housing: tuple[str, Path],
    price_drops: tuple[str, Path],
    out_path: Path,
    region_type: str,
    history_months: int,
    tracked_regions: set[str] | None,
    force: bool,
) -> FetchResult:
    warnings: list[str] = []
    housing_dl = http.download(housing[0], housing[1], force=force)
    try:
        drops_dl = http.download(price_drops[0], price_drops[1], force=force)
        drops_path: Path | None = price_drops[1]
        drops_modified = drops_dl.modified
    except Exception as exc:  # optional: the core metrics still publish
        warnings.append(f"Redfin price-drops file unavailable ({exc}); price_drops is null this run")
        drops_path, drops_modified = None, True
    urls = (housing[0], price_drops[0]) if drops_path else (housing[0],)
    modified = housing_dl.modified or drops_modified
    if not modified and out_path.exists():
        latest = pl.scan_parquet(out_path).select(pl.col("period_end").max()).collect()[0, 0]
        return FetchResult(False, out_path, str(latest) if latest else None, "data_center", urls, tuple(warnings))
    frame = dc_frame(
        housing[1], drops_path, region_type=region_type, history_months=history_months, tracked_regions=tracked_regions
    )
    if frame.is_empty():
        raise RedfinColumnsMissing(f"Redfin Data Center {region_type} file has no rows for the tracked regions")
    return FetchResult(True, out_path, _write_parquet(frame, out_path), "data_center", urls, tuple(warnings))


def fetch_metro(
    http: Http,
    *,
    tracked_regions: set[str] | None = None,
    history_months: int = 36,
    force: bool = False,
) -> FetchResult:
    """Data Center metro data (no fallback; see `fetch_all`)."""
    return _fetch_dc(
        http,
        housing=(METRO_URL, DC_METRO_CSV_PATH),
        price_drops=(PRICE_DROPS_METRO_URL, DC_PRICE_DROPS_METRO_CSV_PATH),
        out_path=DC_METRO_PARQUET_PATH,
        region_type="metro",
        history_months=history_months,
        tracked_regions=tracked_regions,
        force=force,
    )


def fetch_national(http: Http, *, history_months: int = 36, force: bool = False) -> FetchResult:
    """Data Center national data (no fallback; see `fetch_all`)."""
    return _fetch_dc(
        http,
        housing=(NATIONAL_URL, DC_NATIONAL_CSV_PATH),
        price_drops=(PRICE_DROPS_NATIONAL_URL, DC_PRICE_DROPS_NATIONAL_CSV_PATH),
        out_path=DC_NATIONAL_PARQUET_PATH,
        region_type="country",
        history_months=history_months,
        tracked_regions=None,
        force=force,
    )


def fetch_metro_timeline(
    metro_fetch: FetchResult,
    *,
    tracked_regions: set[str] | None,
    since: date,
    out_path: Path = DC_METRO_TIMELINE_PARQUET_PATH,
) -> Path | None:
    """The tracked metros' full monthly history from `since` (§6.4), read from the
    Data Center CSVs `fetch_metro` already downloaded. Legacy-source runs return None:
    the two sources define metrics differently and are never spliced. Rebuilt only
    when the metro files changed (or the extract is missing)."""
    if metro_fetch.source != "data_center" or not DC_METRO_CSV_PATH.exists():
        return None
    if not metro_fetch.modified and out_path.exists():
        return out_path
    drops = DC_PRICE_DROPS_METRO_CSV_PATH if DC_PRICE_DROPS_METRO_CSV_PATH.exists() else None
    frame = dc_frame(DC_METRO_CSV_PATH, drops, region_type="metro", history_months=0, tracked_regions=tracked_regions, since=since)
    if frame.is_empty():
        return None
    _write_parquet(frame, out_path)
    return out_path


def fetch_all(
    http: Http,
    *,
    tracked_regions: set[str] | None = None,
    history_months: int = 36,
    force: bool = False,
) -> tuple[FetchResult, FetchResult]:
    """Metro and national data from ONE source, never mixed: the Data Center, or,
    if either of its files fails, both legacy exports with a warning. (The two
    sources define several metrics differently, so a mix would compare metros
    against a national baseline measured another way.) If the legacy files fail
    too, the error propagates and the run fails, as before."""
    try:
        metro = fetch_metro(http, tracked_regions=tracked_regions, history_months=history_months, force=force)
        national = fetch_national(http, history_months=history_months, force=force)
        return metro, national
    except Exception as exc:
        warning = (
            f"Redfin Data Center files unavailable ({exc}); used the legacy market-tracker export, "
            "which Redfin stopped updating on 2026-06-02"
        )
        metro = fetch_metro_legacy(http, tracked_regions=tracked_regions, history_months=history_months, force=force)
        national = fetch_national_legacy(http, history_months=history_months, force=force)
        metro.warnings = (warning,)
        return metro, national


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
