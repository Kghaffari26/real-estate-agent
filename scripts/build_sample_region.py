"""Add v3 §4.2 region files (`regions/<slug>.json` and `.geo.json`) to the dashboard's
committed sample snapshot, using the agent's own code on Redfin's real ZIP file,
capped at the snapshot's `data_through`, and the committed geometry.

Before writing, it checks that the region summary is consistent with the snapshot:
the region's metros are in it, and the ZIPs' summed homes sold is within 15% of the
metro's own rolling-3-month total from its published series (ZIP files and metro files
are separate Redfin tables, so they agree only approximately).

    uv run python scripts/build_sample_region.py [--sample dashboard/sample-data]
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import polars as pl
from agents_core.http import Http

from agents.real_estate import fetch_redfin
from agents.real_estate import region as region_mod
from agents.real_estate.agent import json_size
from agents.real_estate.config import load_metros, load_regions, load_settings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--sample", default="dashboard/sample-data", type=Path)
    args = parser.parse_args()
    sample: Path = args.sample
    index = json.loads((sample / "latest.json").read_text(encoding="utf8"))
    through = date.fromisoformat(index["data_through"])
    metros = {m.slug: m for m in load_metros()}
    settings = load_settings()
    regions = load_regions()
    with Http(cache_dir=Path("data/cache/http")) as http:
        tracked = {metros[s].redfin_region for r in regions for s in r.metros}
        fetched = fetch_redfin.fetch_zips(http, tracked_regions=tracked, columns=region_mod.FETCH_COLUMNS)
    rows = [r for r in pl.read_parquet(fetched.parquet_path).to_dicts() if r["period_end"] <= through]
    refs = []
    (sample / "regions").mkdir(exist_ok=True)
    for reg in regions:
        geometry = region_mod.load_geometry(reg.geometry)
        names = {metros[s].redfin_region for s in reg.metros}
        out = region_mod.build_region(rows, reg, names, region_mod.geo_info(geometry), through)
        if out is None:
            print(f"{reg.slug}: no rows for {through}")
            return 1
        fitted, warnings = region_mod.fit(out, json_size, int(settings.max_region_kb * 1024))
        for w in warnings:
            print("warning:", w)
        if fitted is None:
            return 1
        # consistency with the snapshot's metro files
        sold = fitted.summary.latest["homes_sold"].value or 0
        metro_3m = 0.0
        for slug in reg.metros:
            detail = json.loads((sample / "metros" / f"{slug}.json").read_text(encoding="utf8"))
            metro_3m += sum(v for v in detail["series"]["homes_sold"][-3:] if v is not None)
        drift = abs(sold / metro_3m - 1) if metro_3m else 1
        print(f"{reg.slug}: ZIP homes sold (3 mo) {sold:,} vs metro series {metro_3m:,.0f} ({drift:.1%} apart)")
        if drift > 0.15:
            print("  too far apart; nothing written")
            return 1
        (sample / "regions" / f"{reg.slug}.json").write_text(fitted.model_dump_json(), encoding="utf8")
        if geometry is not None:
            (sample / "regions" / f"{reg.slug}.geo.json").write_text(geometry.model_dump_json(), encoding="utf8")
        refs.append(region_mod.ref(fitted, geometry is not None).model_dump(mode="json"))
        print(f"  regions/{reg.slug}.json {json_size(fitted) / 1024:.0f} KB: {len(fitted.zips)} ZIPs, {len(fitted.cities)} cities; geometry {region_mod.geometry_size(geometry) / 1024:.0f} KB" if geometry else "")
    index["regions"] = refs
    (sample / "latest.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    print("latest.json: regions refs added")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
