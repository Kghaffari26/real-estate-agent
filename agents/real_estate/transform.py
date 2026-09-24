"""Join Redfin, Zillow, and permits data into one tidy frame keyed by
(slug, period_end): one row per tracked metro per month, with metro
metadata (name, state, cbsa) attached from `config/metros.toml`.

Zillow and permits are optional joins — a metro missing a `zillow_region_id`
or CBSA-level permits data simply gets nulls for those columns, per
SPEC_REAL_ESTATE.md §10.
"""

from __future__ import annotations

import polars as pl

from agents.real_estate.config import Metro


def build_metro_frame(
    redfin_df: pl.DataFrame,
    metros: list[Metro],
    zhvi_long: pl.DataFrame | None = None,
    zori_long: pl.DataFrame | None = None,
    permits_long: pl.DataFrame | None = None,
) -> pl.DataFrame:
    """`redfin_df` is the filtered Redfin parquet (columns include `region`,
    `period_end`, and the raw metric columns). `zhvi_long`/`zori_long` have
    columns `[zillow_region_id, date, zhvi|zori]` (see `fetch_zillow.load_long`).
    `permits_long` has columns `[cbsa, period_end, permits_total,
    permits_1unit, permits_5plus]`. Returns one row per (slug, period_end).
    """
    region_to_slug = {m.redfin_region: m.slug for m in metros}
    slug_to_cbsa = {m.slug: m.cbsa for m in metros}
    region_id_to_slug = {
        m.zillow_region_id: m.slug for m in metros if m.zillow_region_id is not None
    }

    df = (
        redfin_df.with_columns(
            pl.col("region").replace_strict(region_to_slug, default=None).alias("slug")
        )
        .filter(pl.col("slug").is_not_null())
        .with_columns(pl.col("slug").replace_strict(slug_to_cbsa, default=None).alias("cbsa"))
    )

    if zhvi_long is not None and not zhvi_long.is_empty():
        zhvi = (
            zhvi_long.with_columns(
                pl.col("zillow_region_id").replace_strict(region_id_to_slug, default=None).alias("slug")
            )
            .filter(pl.col("slug").is_not_null())
            .select(["slug", "date", "zhvi"])
        )
        df = df.join(zhvi, left_on=["slug", "period_end"], right_on=["slug", "date"], how="left")
    else:
        df = df.with_columns(pl.lit(None, dtype=pl.Float64).alias("zhvi"))

    if zori_long is not None and not zori_long.is_empty():
        zori = (
            zori_long.with_columns(
                pl.col("zillow_region_id").replace_strict(region_id_to_slug, default=None).alias("slug")
            )
            .filter(pl.col("slug").is_not_null())
            .select(["slug", "date", "zori"])
        )
        df = df.join(zori, left_on=["slug", "period_end"], right_on=["slug", "date"], how="left")
    else:
        df = df.with_columns(pl.lit(None, dtype=pl.Float64).alias("zori"))

    if permits_long is not None and not permits_long.is_empty():
        df = df.join(permits_long, on=["cbsa", "period_end"], how="left")
    else:
        df = df.with_columns(
            pl.lit(None, dtype=pl.Float64).alias("permits_total"),
            pl.lit(None, dtype=pl.Float64).alias("permits_1unit"),
            pl.lit(None, dtype=pl.Float64).alias("permits_5plus"),
        )

    return df
