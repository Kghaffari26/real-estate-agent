"""Verify the data source URLs in SPEC_REAL_ESTATE.md §3 are still live.

Does a HEAD request against each and prints status, size, and
Last-Modified, per §3's "Verify each URL during setup" instruction. Run
this before trusting any hardcoded URL in the fetchers — public dataset
URLs change occasionally (Redfin moved everything in 2026-09). `--names` also
checks every tracked metro's name against the live Redfin Data Center files.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # run as a plain script, not a module

from agents_core.http import Http, HttpError  # noqa: E402

from agents.real_estate import fetch_redfin, fetch_zillow  # noqa: E402

URLS: dict[str, str] = {
    "redfin_metro": fetch_redfin.METRO_URL,
    "redfin_price_drops_metro": fetch_redfin.PRICE_DROPS_METRO_URL,
    "redfin_national": fetch_redfin.NATIONAL_URL,
    "redfin_price_drops_national": fetch_redfin.PRICE_DROPS_NATIONAL_URL,
    "redfin_legacy_metro (fallback, frozen 2026-06-02)": fetch_redfin.LEGACY_METRO_URL,
    "zillow_zhvi": fetch_zillow.ZHVI_URL,
    "zillow_zori": fetch_zillow.ZORI_URL,
    "census_bps_index": "https://www2.census.gov/econ/bps/",
    "census_acs_api": "https://api.census.gov/data/2023/acs/acs1",
    "fred_api": "https://api.stlouisfed.org/fred/series/observations",
    "census_gazetteer": "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_cbsa_national.zip",
}
# Endpoints that 400 on a bare HEAD without query params. Keys are read from the
# environment and are redacted from logs by agents_core.http.
PARAMS: dict[str, dict[str, str]] = {
    "census_acs_api": {"get": "NAME", "for": "us:1"},
    "fred_api": {"series_id": "MORTGAGE30US", "file_type": "json", "limit": "1", "api_key": os.environ.get("FRED_API_KEY", "")},
}


def _fmt_size(n: str | None) -> str:
    if not n:
        return "?"
    try:
        mb = int(n) / (1024 * 1024)
        return f"{mb:.1f}MB"
    except ValueError:
        return n


def main() -> int:
    ok = True
    with Http(max_attempts=2) as http:
        for name, url in URLS.items():
            try:
                response = http.request("HEAD", url, params=PARAMS.get(name), ttl_seconds=0)
                status = response.status
                size = _fmt_size(response.headers.get("content-length"))
                last_modified = response.headers.get("last-modified", "?")
                reachable = True
            except HttpError as exc:
                status, size, last_modified, reachable = exc.status or "ERR", "?", str(exc)[:60], False
            except Exception as exc:  # noqa: BLE001
                status, size, last_modified, reachable = "ERR", "?", str(exc)[:60], False
            ok = ok and reachable
            mark = "OK" if reachable else "FAIL"
            print(f"[{mark}] {name:<18} status={status:<5} size={size:<10} last_modified={last_modified}  {url}")
    if not ok:
        print("\nSome sources are unreachable — this may be code, or it may be network policy", file=sys.stderr)
        print("in this environment; a fetcher's optional sources (Zillow, permits, ACS) should", file=sys.stderr)
        print("degrade to null per SPEC_REAL_ESTATE.md §10 rather than fail the whole run.", file=sys.stderr)
    if "--names" in sys.argv:
        ok = check_redfin_names() and ok
    return 0 if ok else 1


def check_redfin_names() -> bool:
    """--names: download both Data Center metro files (~65MB) and confirm every
    tracked metro's `redfin_region` is present in each. The price-drops file has no
    REGION ID, so the fetcher joins it by name."""
    import tempfile

    import polars as pl

    from agents.real_estate.config import load_metros

    wanted = {m.redfin_region for m in load_metros()}
    ok = True
    with tempfile.TemporaryDirectory() as tmp, Http(max_attempts=2) as http:
        for label, url in (("housing", fetch_redfin.METRO_URL), ("price drops", fetch_redfin.PRICE_DROPS_METRO_URL)):
            path = Path(tmp) / "f.csv"
            http.download(url, path, force=True)
            names = set(pl.scan_csv(path, infer_schema_length=0).select("REGION NAME").unique().collect()["REGION NAME"])
            missing = sorted(wanted - names)
            ok = ok and not missing
            print(f"[{'OK' if not missing else 'FAIL'}] {label}: {len(wanted) - len(missing)}/{len(wanted)} tracked metros matched by name {missing or ''}")
    return ok


if __name__ == "__main__":
    sys.exit(main())
