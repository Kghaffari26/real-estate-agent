"""Verify the data source URLs in SPEC_REAL_ESTATE.md §3 are still live.

Does a HEAD request against each and prints status, size, and
Last-Modified, per §3's "Verify each URL during setup" instruction. Run
this before trusting any hardcoded URL in the fetchers — public dataset
URLs change occasionally.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # run as a plain script, not a module

from agents_core.http import HTTPClient  # noqa: E402

from agents.real_estate import fetch_redfin, fetch_zillow  # noqa: E402

URLS: dict[str, str] = {
    "redfin_metro": fetch_redfin.METRO_URL,
    "redfin_national": fetch_redfin.NATIONAL_URL,
    "zillow_zhvi": fetch_zillow.ZHVI_URL,
    "zillow_zori": fetch_zillow.ZORI_URL,
    "census_bps_index": "https://www2.census.gov/econ/bps/",
    "census_acs_api": "https://api.census.gov/data/2023/acs/acs1",
    "fred_api": "https://api.stlouisfed.org/fred/series/observations",
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
    with HTTPClient() as client:
        for name, url in URLS.items():
            try:
                response = client.head(url)
                status = response.status_code
                size = _fmt_size(response.headers.get("Content-Length"))
                last_modified = response.headers.get("Last-Modified", "?")
                reachable = status < 400
            except Exception as exc:  # noqa: BLE001
                status, size, last_modified, reachable = "ERR", "?", str(exc)[:60], False
            ok = ok and reachable
            mark = "OK" if reachable else "FAIL"
            print(f"[{mark}] {name:<18} status={status:<5} size={size:<10} last_modified={last_modified}  {url}")
    if not ok:
        print("\nSome sources are unreachable — this may be code, or it may be network policy", file=sys.stderr)
        print("in this environment; a fetcher's optional sources (Zillow, permits, ACS) should", file=sys.stderr)
        print("degrade to null per SPEC_REAL_ESTATE.md §10 rather than fail the whole run.", file=sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
