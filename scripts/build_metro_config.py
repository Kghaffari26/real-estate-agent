"""One-time: propose the top 50 US metros (by trailing-12-month homes sold)
with their Redfin region string, Zillow RegionID, CBSA code, and lat/lon
centroid (SPEC_REAL_ESTATE.md §8). Writes `config/metros.toml` with a
commented-out, `# REVIEW`-flagged line for any field that couldn't be
matched, for a human to fill in or confirm.

The real OMB CBSA code needs Census Gazetteer name-matching, same as the
lat/lon centroid — Redfin's own `PARENT_METRO_REGION_METRO_CODE` looks
like a CBSA code but isn't one (confirmed against known values: Redfin
gives Chicago 16984 vs. the real CBSA 16980, Los Angeles 31084 vs. 31080,
New York 35614 vs. 35620), so it's surfaced only as a REVIEW hint, never
written as `cbsa` directly. All three of CBSA, Zillow RegionID, and
lat/lon are skipped with a REVIEW flag if their source is unreachable,
rather than guessed.
"""

from __future__ import annotations

import io
import re
import sys
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # run as a plain script, not a module

import polars as pl  # noqa: E402
from agents_core.http import Http  # noqa: E402

from agents.real_estate import fetch_redfin, fetch_zillow  # noqa: E402

METROS_TOML_PATH = Path("config/metros.toml")
TOP_N = 50
GAZETTEER_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_cbsa_national.zip"


def slugify(name: str) -> str:
    """"Austin, TX" -> "austin-tx"."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    ascii_name = ascii_name.lower().replace(",", "")
    return re.sub(r"[^a-z0-9]+", "-", ascii_name).strip("-")


def _normalize_for_match(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def build_zillow_index(csv_path: Path) -> dict[str, int]:
    """`{normalized RegionName: RegionID}` from a Zillow wide CSV."""
    df = pl.read_csv(csv_path, columns=["RegionID", "RegionName"], infer_schema_length=10000)
    return {_normalize_for_match(row["RegionName"]): row["RegionID"] for row in df.to_dicts()}


@dataclass(frozen=True)
class CbsaRef:
    geoid: str
    name: str  # e.g. "Dallas-Fort Worth-Arlington, TX Metro Area"
    cities: tuple[str, ...]  # normalized principal cities, in title order
    states: tuple[str, ...]  # e.g. ("TX",)
    lat: float
    lon: float


def parse_gazetteer(text: str) -> list[CbsaRef]:
    """Metropolitan (not micropolitan) CBSAs from the Census Gazetteer CBSA file."""
    lines = [line for line in text.splitlines() if line.strip()]
    header = [h.strip() for h in lines[0].split("\t")]
    idx_geoid = header.index("GEOID")
    idx_name = header.index("NAME")
    idx_lat = header.index("INTPTLAT")
    idx_lon = header.index("INTPTLONG")

    out: list[CbsaRef] = []
    for line in lines[1:]:
        cells = [c.strip() for c in line.split("\t")]
        if len(cells) <= max(idx_geoid, idx_name, idx_lat, idx_lon):
            continue
        name = cells[idx_name]
        if not name.endswith(" Metro Area") or "," not in name:
            continue
        title, _, rest = name.removesuffix(" Metro Area").rpartition(",")
        try:
            out.append(
                CbsaRef(
                    geoid=cells[idx_geoid],
                    name=name,
                    cities=tuple(_normalize_for_match(c) for c in title.split("-") if c),
                    states=tuple(s.strip() for s in rest.split("-")),
                    lat=float(cells[idx_lat]),
                    lon=float(cells[idx_lon]),
                )
            )
        except ValueError:
            continue
    return out


def fetch_cbsa_reference(http: Http) -> list[CbsaRef]:
    """The Census Gazetteer CBSA file — the authoritative source for CBSA code
    and centroid at once, matched by name (never by Redfin's metro code)."""
    raw = http.get(GAZETTEER_URL, ttl_seconds=0).content
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        name = next(n for n in zf.namelist() if n.lower().endswith(".txt"))
        return parse_gazetteer(zf.read(name).decode("latin-1"))


# Redfin metro divisions whose name isn't one of their parent CBSA's principal
# cities, so name matching alone can't find the parent. Values are the parent
# metro's principal city + state, resolved against the Gazetteer like any other
# name (not a hardcoded CBSA code).
DIVISION_PARENT_CITY: dict[str, str] = {
    "New Brunswick, NJ": "New York, NY",
    "Nassau County, NY": "New York, NY",
    "Montgomery County, PA": "Philadelphia, PA",
}


def match_gazetteer(display_name: str, gazetteer: list[CbsaRef]) -> CbsaRef | None:
    """`display_name` is Redfin's short form ("Columbus, OH"); a Gazetteer metro
    matches when that city is one of its hyphenated principal cities AND the
    state is one of its states ("Columbus, OH" must not match "Columbus, GA-AL").
    A city that leads the CBSA title wins over one listed later in it.
    """
    display_name = DIVISION_PARENT_CITY.get(display_name, display_name)
    if "," not in display_name:
        return None
    city, _, state = display_name.rpartition(",")
    city, state = _normalize_for_match(city), state.strip()
    candidates = [g for g in gazetteer if state in g.states and city in g.cities]
    if not candidates:
        return None
    return min(candidates, key=lambda g: g.cities.index(city))


def main() -> int:
    with Http() as http:
        fetch_redfin.download_metro_file(http)
        ranked = fetch_redfin.top_metros_by_homes_sold(fetch_redfin.METRO_GZ_PATH, n=TOP_N)

        zillow_index: dict[str, int] = {}
        try:
            fetch_zillow.download_zhvi(http)
            zillow_index = build_zillow_index(fetch_zillow.ZHVI_CSV_PATH)
        except Exception as exc:  # noqa: BLE001
            print(f"NOTE: Zillow RegionID matching skipped: {exc}", file=sys.stderr)

        gazetteer: list[CbsaRef] = []
        try:
            gazetteer = fetch_cbsa_reference(http)
        except Exception as exc:  # noqa: BLE001
            print(f"NOTE: Census Gazetteer CBSA/centroid matching skipped: {exc}", file=sys.stderr)

    rows = ranked.to_dicts()
    lines: list[str] = [
        f"# Generated by scripts/build_metro_config.py on {__import__('datetime').date.today().isoformat()},",
        "# then reviewed by hand. See SPEC_REAL_ESTATE.md §8.",
        "",
    ]
    zillow_matches = 0
    centroid_matches = 0
    cbsa_matches = 0
    division_notes = 0

    for row in rows:
        region = row["region"]  # e.g. "Austin, TX metro area"
        display_name = row.get("parent_metro_region") or region.replace(" metro area", "")
        slug = slugify(display_name)
        zillow_id = zillow_index.get(_normalize_for_match(display_name))
        gaz_match = match_gazetteer(display_name, gazetteer)

        lines.append("[[metro]]")
        lines.append(f'slug = "{slug}"')
        lines.append(f'name = "{display_name}"')
        lines.append(f'redfin_region = "{region}"')

        redfin_code = row.get("redfin_metro_code")
        if gaz_match is not None:
            if redfin_code and str(redfin_code) != gaz_match.geoid:
                # Redfin's code is usually the OMB CBSA code, but for a metro
                # *division* it's the division code (Chicago 16984 in CBSA 16980),
                # and some are pre-2023 codes (Cleveland 17460, now 17410).
                lines.append(
                    f"# REVIEW: Redfin code {redfin_code} != CBSA {gaz_match.geoid} (a metro division"
                    f' or a pre-2023 code); cbsa/lat/lon are for "{gaz_match.name}"'
                )
                division_notes += 1
            lines.append(f'cbsa = "{gaz_match.geoid}"')
            lines.append(f"lat = {gaz_match.lat}")
            lines.append(f"lon = {gaz_match.lon}")
            cbsa_matches += 1
            centroid_matches += 1
        else:
            hint = f" (Redfin's own code is {redfin_code}, NOT the CBSA code)" if redfin_code else ""
            lines.append(f'# cbsa = ""  # REVIEW: match by name against the Census Gazetteer CBSA file{hint}')
            lines.append("# lat = 0.0  # REVIEW: fill from the Census Gazetteer CBSA file")
            lines.append("# lon = 0.0  # REVIEW: fill from the Census Gazetteer CBSA file")

        if zillow_id is not None:
            lines.append(f"zillow_region_id = {zillow_id}")
            zillow_matches += 1
        else:
            lines.append("# zillow_region_id = 0  # REVIEW: fill from the Zillow ZHVI CSV's RegionID column")
        lines.append("")

    METROS_TOML_PATH.parent.mkdir(parents=True, exist_ok=True)
    METROS_TOML_PATH.write_text("\n".join(lines))

    print(f"Wrote {METROS_TOML_PATH} with {len(rows)} metros.")
    print(f"CBSA matched (Gazetteer name match): {cbsa_matches}/{len(rows)}")
    print(f"Redfin code != CBSA (division or old code; REVIEW): {division_notes}")
    print(f"Zillow RegionID matched: {zillow_matches}/{len(rows)}")
    print(f"Centroid matched: {centroid_matches}/{len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
