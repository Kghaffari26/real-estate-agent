"""Place metro divisions at their own counties, not their parent CBSA's centroid.

Redfin tracks some metros as **divisions** of a larger CBSA (Anaheim = Orange County
inside Los Angeles-Long Beach-Anaheim; Fort Worth inside Dallas; Nassau County and New
Brunswick inside New York...). `build_metro_config.py` gave every division its parent
CBSA's Gazetteer centroid, so 14 metros sat on 6 points and their columns stacked (the
Anaheim column was drawn over Los Angeles).

For every metro that shares its CBSA with another tracked metro, this sets `lat`/`lon`
to the **homes-sold-weighted mean of its counties' Gazetteer internal points**
(`config/county_centroids.csv`; the counties and their trailing-12-month homes sold
from Redfin's county file, whose `METRO` column is our `redfin_region`). Metros that
are a whole CBSA keep the Gazetteer CBSA centroid. It edits the two lines in place,
leaving the hand-reviewed file otherwise untouched, and prints what moved.

    uv run python scripts/fix_division_coords.py [--dry-run]
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import polars as pl  # noqa: E402
from agents_core.http import Http  # noqa: E402

from agents.real_estate import fetch_redfin  # noqa: E402
from agents.real_estate.areas import AREA_COLUMNS, load_centroids  # noqa: E402
from agents.real_estate.config import DEFAULT_METROS_PATH, load_metros  # noqa: E402


def division_coords(rows: list[dict], centroids: dict, regions: set[str]) -> dict[str, tuple[float, float]]:
    """region -> (lat, lon): the homes-sold-weighted mean of its counties' centroids
    (an unweighted mean when no county reports sales)."""
    sold: dict[tuple[str, str], float] = defaultdict(float)
    for r in rows:
        if r["metro"] in regions and r.get("region") in centroids:
            sold[(r["metro"], r["region"])] += r.get("homes_sold") or 0.0
    out: dict[str, tuple[float, float]] = {}
    for region in regions:
        counties = [(name, w) for (m, name), w in sold.items() if m == region]
        if not counties:
            continue
        total = sum(w for _, w in counties)
        weights = [(name, (w / total) if total else 1 / len(counties)) for name, w in counties]
        lat = sum(centroids[n].lat * w for n, w in weights)
        lon = sum(centroids[n].lon * w for n, w in weights)
        out[region] = (round(lat, 6), round(lon, 6))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    metros = load_metros()
    by_cbsa: dict[str | None, list] = defaultdict(list)
    for m in metros:
        by_cbsa[m.cbsa].append(m)
    divisions = [m for group in by_cbsa.values() if len(group) > 1 for m in group]
    if not divisions:
        print("no shared CBSAs; nothing to do")
        return 0
    with Http(cache_dir=Path("data/cache/http")) as http:
        fetched = fetch_redfin.fetch_counties(http, tracked_regions={m.redfin_region for m in metros}, columns=AREA_COLUMNS)
    frame = pl.read_parquet(fetched.parquet_path)
    latest = frame["period_end"].max()
    rows = frame.filter(pl.col("period_end") > latest - timedelta(days=365)).to_dicts()
    coords = division_coords(rows, load_centroids(), {m.redfin_region for m in divisions})

    text = Path(DEFAULT_METROS_PATH).read_text(encoding="utf8")
    for m in divisions:
        new = coords.get(m.redfin_region)
        if new is None:
            print(f"  {m.slug}: no county data; left at {m.lat}, {m.lon}")
            continue
        block = re.compile(rf'(slug = "{re.escape(m.slug)}"\n(?:[^\[]*?\n)?)lat = [-\d.]+\nlon = [-\d.]+')
        text, n = block.subn(lambda mt, new=new: f"{mt.group(1)}lat = {new[0]}\nlon = {new[1]}", text, count=1)
        if n != 1:
            print(f"  {m.slug}: couldn't find its lat/lon lines")
            return 1
        print(f"  {m.slug:22} ({m.lat}, {m.lon}) -> {new}")
    if not args.dry_run:
        Path(DEFAULT_METROS_PATH).write_text(text, encoding="utf8", newline="\n")
        print(f"updated {DEFAULT_METROS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
