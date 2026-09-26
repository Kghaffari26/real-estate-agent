"""Fetch median household income by metro from the Census ACS 1-year API
(SPEC_REAL_ESTATE.md §3.5), for the affordability `payment_to_income` ratio.

Refreshed at most once a year, so results are cached to
`data/real_estate/acs_income.json` and reused otherwise. Optional: if the
fetch fails, callers should treat missing income as null and skip
`payment_to_income` for that metro rather than fail the run.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from agents_core.http import Http

CACHE_PATH = Path("data/real_estate/acs_income.json")
GEO_COLUMN = "metropolitan statistical area/micropolitan statistical area"


class AcsIncomeError(RuntimeError):
    """The ACS response didn't look like the documented `NAME,B19013_001E` shape."""


def fetch_income_by_cbsa(
    http: Http, year: int, api_key: str | None = None
) -> dict[str, int]:
    """Returns `{cbsa_code: median_household_income}` for every metro/micro
    area the ACS 1-year API reports (SPEC §3.5)."""
    api_key = api_key or os.environ.get("CENSUS_API_KEY")
    url = f"https://api.census.gov/data/{year}/acs/acs1"
    params: dict[str, str] = {"get": "NAME,B19013_001E", "for": GEO_COLUMN + ":*"}
    if api_key:
        params["key"] = api_key

    # No Http TTL cache: results are cached in CACHE_PATH instead, and a cached
    # error page (the key is excluded from Http's cache key) would outlive a fix.
    response = http.get(url, params=params, ttl_seconds=0)
    try:
        rows = response.json()
    except ValueError as exc:
        # The API redirects keyless/invalid-key requests to an HTML page.
        hint = "" if api_key else " (the Census API now requires CENSUS_API_KEY)"
        raise AcsIncomeError(f"ACS {year}: non-JSON response{hint}") from exc
    if not rows or len(rows) < 2:
        raise AcsIncomeError(f"unexpected ACS response: {rows!r}")
    header, *data_rows = rows
    try:
        income_idx = header.index("B19013_001E")
        geo_idx = header.index(GEO_COLUMN)
    except ValueError as exc:
        raise AcsIncomeError(f"unexpected ACS columns: {header!r}") from exc

    out: dict[str, int] = {}
    for row in data_rows:
        cbsa = row[geo_idx]
        try:
            income = int(row[income_idx])
        except (ValueError, TypeError):
            continue
        if income > 0:
            out[cbsa] = income
    return out


def load_cached(path: Path = CACHE_PATH) -> tuple[dict[str, int], int | None]:
    """Returns `(income_by_cbsa, year)` from the cache, or `({}, None)`."""
    if not path.exists():
        return {}, None
    data = json.loads(path.read_text())
    return data.get("income_by_cbsa", {}), data.get("year")


def save_cache(income_by_cbsa: dict[str, int], year: int, path: Path = CACHE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"year": year, "income_by_cbsa": income_by_cbsa}, indent=2))
