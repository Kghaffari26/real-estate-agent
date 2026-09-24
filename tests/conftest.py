from __future__ import annotations

from datetime import date

import pytest


def month_series(start: tuple[int, int], values: list[float | None]) -> list[tuple[date, float | None]]:
    """Build a list of (month-end date, value) pairs starting at (year, month),
    one entry per month, in order."""
    out: list[tuple[date, float | None]] = []
    year, month = start
    for v in values:
        # Use day=1 for simplicity; compute.py keys strictly by (year, month).
        out.append((date(year, month, 1), v))
        month += 1
        if month > 12:
            month = 1
            year += 1
    return out


@pytest.fixture
def sample_metro():
    from agents.real_estate.config import Metro

    return Metro(
        slug="test-metro",
        name="Test Metro, TX",
        redfin_region="Test Metro, TX metro area",
        cbsa="12345",
        lat=30.0,
        lon=-95.0,
        zillow_region_id=999,
    )


@pytest.fixture
def sample_settings():
    from agents.real_estate.config import Settings

    return Settings()
