"""Build `config/regions/<slug>.geo.json` (v3 §4.2) for every region in
`config/regions.toml`: simplified ZIP (2020 ZCTA) and city boundaries with each ZIP's
city, from the U.S. Census Bureau.

- **ZIPs**: every ZIP Redfin reports under the region's metros (its ZIP file), drawn
  as its 2020 ZIP Code Tabulation Area. A ZIP with no ZCTA (e.g. a P.O.-box ZIP) is
  kept without a shape or a centroid.
- **City of a ZIP**: the incorporated place with the most land overlap
  (`tab20_zcta520_place20_natl.txt`); when incorporated places cover under a quarter of
  the ZCTA's land, the census-designated place with the most overlap (Orange County
  has large unincorporated communities such as Ladera Ranch); else "Unincorporated".
- **Shapes** come from Census TIGERweb as GeoJSON, generalized on the server
  (`maxAllowableOffset` ≈ 40 m, 5-decimal coordinates) to keep the file small.

Run once per region (and when `config/regions.toml` changes); the agent only reads the
committed file.

    uv run python scripts/build_region_geometry.py
"""

from __future__ import annotations

import csv
import io
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import polars as pl  # noqa: E402
from agents_core.http import Http  # noqa: E402

from agents.real_estate import fetch_redfin  # noqa: E402
from agents.real_estate.config import load_metros, load_regions  # noqa: E402
from agents.real_estate.region import FETCH_COLUMNS  # noqa: E402

TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb"
ZCTA_LAYER = f"{TIGER}/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query"
PLACE_LAYERS = {"incorporated": f"{TIGER}/Places_CouSub_ConCity_SubMCD/MapServer/4/query", "cdp": f"{TIGER}/Places_CouSub_ConCity_SubMCD/MapServer/5/query"}
REL_URL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_place20_natl.txt"
OFFSET = 0.0004  # degrees (~40 m): server-side generalization
MIN_INCORPORATED_SHARE = 0.25


def query(http: Http, url: str, where: str, fields: str) -> list[dict]:
    r = http.get(url, params={"where": where, "outFields": fields, "outSR": "4326", "maxAllowableOffset": str(OFFSET), "geometryPrecision": "5", "f": "geojson"}, ttl_seconds=7 * 86400)
    return r.json().get("features", [])


def chunks(xs: list[str], n: int = 40):
    for i in range(0, len(xs), n):
        yield xs[i : i + n]


def main() -> int:
    metros = {m.slug: m for m in load_metros()}
    regions = load_regions()
    with Http(cache_dir=Path("data/cache/http")) as http:
        tracked = {metros[s].redfin_region for r in regions for s in r.metros}
        zips_fetch = fetch_redfin.fetch_zips(http, tracked_regions=tracked, columns=FETCH_COLUMNS)
        rel_text = http.get(REL_URL, ttl_seconds=30 * 86400).content.decode("utf-8-sig")
        frame = pl.read_parquet(zips_fetch.parquet_path)
        for region in regions:
            names = {metros[s].redfin_region for s in region.metros}
            zips = sorted(set(frame.filter(pl.col("metro").is_in(sorted(names)))["zip"].drop_nulls().to_list()))
            # ZIP -> places with land overlap
            overlap: dict[str, list[tuple[str, str, str, int, int]]] = defaultdict(list)  # zip -> (geoid, name, mtfcc, part, zcta_land)
            for row in csv.DictReader(io.StringIO(rel_text), delimiter="|"):
                z = row["GEOID_ZCTA5_20"]
                if z in zips and row["GEOID_PLACE_20"]:
                    overlap[z].append((row["GEOID_PLACE_20"], row["NAMELSAD_PLACE_20"], row["MTFCC_PLACE_20"], int(row["AREALAND_PART"] or 0), int(row["AREALAND_ZCTA5_20"] or 0)))
            city_of: dict[str, tuple[str, str]] = {}  # zip -> (geoid, display name)
            for z in zips:
                parts = overlap.get(z, [])
                land = max((p[4] for p in parts), default=0)
                inc = sorted((p for p in parts if p[2] == "G4110"), key=lambda p: -p[3])
                cdp = sorted((p for p in parts if p[2] == "G4210"), key=lambda p: -p[3])
                if inc and land and sum(p[3] for p in inc) / land >= MIN_INCORPORATED_SHARE:
                    best = inc[0]
                elif cdp:
                    best = cdp[0]
                elif inc:
                    best = inc[0]
                else:
                    continue
                name = best[1].removesuffix(" city").removesuffix(" CDP").removesuffix(" town")
                city_of[z] = (best[0], name)
            features: list[dict] = []
            got: set[str] = set()
            for batch in chunks(zips):
                where = "ZCTA5 IN (" + ",".join(f"'{z}'" for z in batch) + ")"
                for f in query(http, ZCTA_LAYER, where, "ZCTA5,INTPTLAT,INTPTLON"):
                    z = f["properties"]["ZCTA5"]
                    got.add(z)
                    geoid, city = city_of.get(z, (None, None))
                    features.append({"type": "Feature", "geometry": f["geometry"], "properties": {"kind": "zip", "id": z, "city": city, "city_id": geoid, "lat": round(float(f["properties"]["INTPTLAT"]), 5), "lon": round(float(f["properties"]["INTPTLON"]), 5)}})
            for z in zips:
                if z not in got:
                    geoid, city = city_of.get(z, (None, None))
                    features.append({"type": "Feature", "geometry": None, "properties": {"kind": "zip", "id": z, "city": city, "city_id": geoid, "lat": None, "lon": None}})
            place_ids = sorted({g for g, _ in city_of.values()})
            names_by_id = {g: n for g, n in city_of.values()}
            for layer in PLACE_LAYERS.values():
                for batch in chunks(place_ids):
                    where = "GEOID IN (" + ",".join(f"'{g}'" for g in batch) + ")"
                    for f in query(http, layer, where, "GEOID,BASENAME,INTPTLAT,INTPTLON"):
                        g = f["properties"]["GEOID"]
                        features.append({"type": "Feature", "geometry": f["geometry"], "properties": {"kind": "city", "id": g, "name": names_by_id.get(g, f["properties"]["BASENAME"]), "lat": round(float(f["properties"]["INTPTLAT"]), 5), "lon": round(float(f["properties"]["INTPTLON"]), 5)}})
            out = {"type": "FeatureCollection", "features": features}
            path = Path(region.geometry)
            path.parent.mkdir(parents=True, exist_ok=True)
            text = json.dumps(out, separators=(",", ":"))
            path.write_text(text + "\n", encoding="utf8", newline="\n")
            n_city = sum(1 for f in features if f["properties"]["kind"] == "city")
            print(f"{region.slug}: {len(zips)} ZIPs ({len(got)} with a ZCTA shape, {len(city_of)} with a city), {n_city} city shapes, {len(text) / 1024:.0f} KB")
            missing = [z for z in zips if z not in got]
            if missing:
                print("  no ZCTA:", ", ".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
