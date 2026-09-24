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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # run as a plain script, not a module

import polars as pl  # noqa: E402

from agents.real_estate import fetch_redfin, fetch_zillow  # noqa: E402
from core.http import HTTPClient  # noqa: E402

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


def fetch_cbsa_reference(client: HTTPClient) -> dict[str, tuple[str, float, float]]:
    """`{normalized CBSA name: (geoid, lat, lon)}` from the Census Gazetteer
    CBSA file — the authoritative source for both fields at once, matched by
    name (never by Redfin's look-alike-but-different metro code)."""
    raw = client.get_bytes(GAZETTEER_URL)
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        name = next(n for n in zf.namelist() if n.lower().endswith(".txt"))
        text = zf.read(name).decode("latin-1")

    lines = [line for line in text.splitlines() if line.strip()]
    header = [h.strip() for h in lines[0].split("\t")]
    idx_geoid = header.index("GEOID")
    idx_name = header.index("NAME")
    idx_lat = header.index("INTPTLAT")
    idx_lon = header.index("INTPTLONG")

    out: dict[str, tuple[str, float, float]] = {}
    for line in lines[1:]:
        cells = line.split("\t")
        if len(cells) <= max(idx_geoid, idx_name, idx_lat, idx_lon):
            continue
        try:
            out[_normalize_for_match(cells[idx_name])] = (
                cells[idx_geoid].strip(),
                float(cells[idx_lat]),
                float(cells[idx_lon]),
            )
        except ValueError:
            continue
    return out


def _match_gazetteer(
    display_name: str, gazetteer: dict[str, tuple[str, float, float]]
) -> tuple[str, float, float] | None:
    """`display_name` is Redfin's short form (e.g. "Chicago, IL"); Gazetteer
    NAMEs are the full CBSA title (e.g. "Chicago-Naperville-Elgin, IL-IN-WI").
    Matches by primary city name rather than exact equality — a heuristic
    that can misfire on a city-name collision, so always spot-check the
    result by hand (the point of this script producing a *draft*).
    """
    if "," not in display_name:
        return None
    primary_city = _normalize_for_match(display_name.split(",")[0].split("-")[0])
    if not primary_city:
        return None
    for norm_name, value in gazetteer.items():
        if norm_name.startswith(primary_city):
            return value
    return None


def main() -> int:
    with HTTPClient() as client:
        fetch_redfin.download_metro_file(client)
        ranked = fetch_redfin.top_metros_by_homes_sold(fetch_redfin.METRO_GZ_PATH, n=TOP_N)

        zillow_index: dict[str, int] = {}
        try:
            client.download(fetch_zillow.ZHVI_URL, fetch_zillow.ZHVI_CSV_PATH)
            zillow_index = build_zillow_index(fetch_zillow.ZHVI_CSV_PATH)
        except Exception as exc:  # noqa: BLE001
            print(f"NOTE: Zillow RegionID matching skipped: {exc}", file=sys.stderr)

        gazetteer: dict[str, tuple[str, float, float]] = {}
        try:
            gazetteer = fetch_cbsa_reference(client)
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

    for row in rows:
        region = row["region"]  # e.g. "Austin, TX metro area"
        display_name = row.get("parent_metro_region") or region.replace(" metro area", "")
        slug = slugify(display_name)
        zillow_id = zillow_index.get(_normalize_for_match(display_name))
        gaz_match = _match_gazetteer(display_name, gazetteer)

        lines.append("[[metro]]")
        lines.append(f'slug = "{slug}"')
        lines.append(f'name = "{display_name}"')
        lines.append(f'redfin_region = "{region}"')

        if gaz_match is not None:
            lines.append(f'cbsa = "{gaz_match[0]}"')
            lines.append(f"lat = {gaz_match[1]}")
            lines.append(f"lon = {gaz_match[2]}")
            cbsa_matches += 1
            centroid_matches += 1
        else:
            redfin_code = row.get("redfin_metro_code")
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
    print(f"CBSA matched (from Redfin itself): {cbsa_matches}/{len(rows)}")
    print(f"Zillow RegionID matched: {zillow_matches}/{len(rows)}")
    print(f"Centroid matched: {centroid_matches}/{len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
