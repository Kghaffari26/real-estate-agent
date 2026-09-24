"""Fetch FRED (Federal Reserve Economic Data) national series.

A thin wrapper around FRED's `series/observations` endpoint, with the
on-disk TTL cache from `core.http.HTTPClient` doing double duty as
change detection: if the cache hasn't expired, no request is made at all,
and when one is made the raw observations are what determine whether a
series actually moved since the last run (compared upstream against
`state.json`, not here).
"""

from __future__ import annotations

import os

from core.http import HTTPClient

BASE_URL = "https://api.stlouisfed.org/fred/series/observations"

#: registry key -> FRED series id (SPEC_REAL_ESTATE.md §2, national-only series)
SERIES: dict[str, str] = {
    "mortgage30": "MORTGAGE30US",
    "mortgage15": "MORTGAGE15US",
    "housing_starts": "HOUST",
    "permits_national": "PERMIT",
    "case_shiller": "CSUSHPINSA",
    "median_price_new_and_existing": "MSPUS",
}


class FredError(RuntimeError):
    """Raised for a missing API key or a malformed FRED response."""


def fetch_series(
    client: HTTPClient,
    series_id: str,
    *,
    api_key: str | None = None,
    observation_start: str = "2000-01-01",
    ttl_seconds: int = 3600 * 6,
) -> list[dict[str, str]]:
    """Return `{"date": ..., "value": ...}` observations, oldest first,
    with FRED's `"."` null marker dropped."""
    api_key = api_key or os.environ.get("FRED_API_KEY")
    if not api_key:
        raise FredError("FRED_API_KEY is not set")
    params = {
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
        "observation_start": observation_start,
    }
    data = client.get_json(BASE_URL, params=params, ttl_seconds=ttl_seconds)
    observations = data.get("observations")
    if observations is None:
        raise FredError(f"unexpected FRED response for {series_id}: {data}")
    return [o for o in observations if o.get("value") not in (None, ".")]


def latest_value(observations: list[dict[str, str]]) -> tuple[str, float] | None:
    if not observations:
        return None
    last = observations[-1]
    return last["date"], float(last["value"])


def value_n_days_before(
    observations: list[dict[str, str]], days: int, tolerance_days: int = 10
) -> float | None:
    """The observation closest to `days` before the series' latest date,
    within `tolerance_days` — used for e.g. "mortgage rate 52 weeks ago"
    from a weekly series that doesn't land on an exact anniversary date."""
    if not observations:
        return None
    from datetime import date as _date
    from datetime import timedelta

    latest_date = _date.fromisoformat(observations[-1]["date"])
    target = latest_date - timedelta(days=days)
    best: float | None = None
    best_diff: int | None = None
    for obs in observations:
        d = _date.fromisoformat(obs["date"])
        diff = abs((d - target).days)
        if diff <= tolerance_days and (best_diff is None or diff < best_diff):
            best = float(obs["value"])
            best_diff = diff
    return best


def fetch_all_national(
    client: HTTPClient, api_key: str | None = None
) -> dict[str, list[dict[str, str]]]:
    """Fetch every series in `SERIES`. A failure on any one series propagates
    (unlike Zillow/permits, FRED has no optional-fallback path in the spec)."""
    return {key: fetch_series(client, series_id, api_key=api_key) for key, series_id in SERIES.items()}
