"""§6.5-6.7 dashboard extensions: the event rail's detectors (the same cases the
dashboard's former TypeScript detector was tested with), the weekly pulse and the
county areas, their budgets, and the fetchers' filtering."""

from __future__ import annotations

import json
from datetime import date, timedelta

import httpx
import polars as pl
import pytest
import respx
from agents_core.http import Http

from agents.real_estate import areas, events, fetch_redfin, pulse
from agents.real_estate.config import Metro
from tests import redfin_dc_fixtures as dc

WEEKS = [date(2024, 1, 7) + timedelta(weeks=i) for i in range(13)]


def _turns(values, **kw):
    pairs = [(d, v) for d, v in zip(WEEKS, values, strict=True) if v is not None]
    return [(e.kind, WEEKS.index(e.date), e.value) for e in events.rate_turns(pairs, **kw)]


# ---- §6.5 events -------------------------------------------------------------


def test_rate_turns_find_prominent_highs_and_lows_oldest_first():
    values = [6.5, 6.9, 7.4, 7.0, 6.6, 6.2, 6.0, 6.3, 6.8, 7.1, 6.9, 6.7, 6.8]
    assert _turns(values, window=2, min_prominence=0.25) == [("rate_high", 2, 7.4), ("rate_low", 6, 6.0), ("rate_high", 9, 7.1)]
    # the late high stands 0.4 above the lowest point (6.7) between it and the series end
    late = events.rate_turns(list(zip(WEEKS, values, strict=True)), window=2, min_prominence=0.25)[-1]
    assert late.prominence == 0.4 and late.metric == "mortgage30"


def test_rate_turns_keep_the_windows_extremes_even_at_the_edges():
    values = [7.6, 7.79, 7.5, 7.2, 6.9, 6.6, 6.8, 7.0, 7.04, 6.9, 6.5, 6.2, 6.0]
    got = _turns(values, window=2, min_prominence=0.25)
    assert [(i, v) for k, i, v in got if k == "rate_high"] == [(1, 7.79), (8, 7.04)]
    assert [i for k, i, _ in got if k == "rate_low"] == [5, 12]  # the Jun dip, then the last week (the window's low)


def test_rate_turns_ignore_wiggles_skip_gaps_and_count_a_plateau_once():
    wiggle = [7.0, 7.05, 7.0, 7.08, 7.02, 7.06, 7.0, 7.04, 7.01, 7.03, 7.0, 7.05, 7.02]
    assert _turns(wiggle, window=1, min_prominence=0.25) == []
    gappy = [6.0, None, 7.0, 7.0, 6.2, None, 6.1, 6.9, 6.9, 6.0, 5.5, 5.9, 6.4]
    got = _turns(gappy, window=2, min_prominence=0.3)
    assert [i for k, i, _ in got if k == "rate_high"] == [2, 7]
    assert [i for k, i, _ in got if k == "rate_low"] == [6, 10]
    assert events.rate_turns([(WEEKS[0], 1.0), (WEEKS[1], 2.0)]) == []


def _monthly(start: date, values):
    out, y, m = [], start.year, start.month
    for v in values:
        out.append((date(y, m, 28), v))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def test_price_turns_cross_zero_and_hold_three_months_each_side():
    # The 2023 national dip, as published: exact zeros in Feb and Jun side with neither sign.
    yoy = [0.0147, 0.0089, 0.0, -0.0189, -0.0267, -0.0132, 0.0, 0.0185, 0.0381, 0.0211]
    got = events.price_turns(_monthly(date(2022, 12, 1), yoy))
    assert [(e.kind, e.date, e.value) for e in got] == [
        ("price_yoy_turn_down", date(2023, 3, 28), -0.0189),
        ("price_yoy_turn_up", date(2023, 7, 28), 0.0185),
    ]
    # A one- or two-month blip is not a turn, a run of zeros alone is not the old sign,
    # and a missing month breaks the window.
    assert events.price_turns(_monthly(date(2022, 1, 1), [0.03, 0.02, 0.01, -0.01, -0.02, 0.01, 0.02, 0.03])) == []
    assert events.price_turns(_monthly(date(2022, 1, 1), [0.0, 0.0, 0.0, -0.01, -0.02, -0.03])) == []
    assert events.price_turns(_monthly(date(2022, 1, 1), [0.03, None, 0.01, -0.01, -0.02, -0.03])) == []


def test_yoy_uses_the_same_calendar_month_a_year_earlier():
    series = _monthly(date(2020, 1, 1), [100.0 + i for i in range(14)])
    got = events.yoy(series)
    assert got[11][1] is None and got[12][1] == pytest.approx(112 / 100 - 1)
    assert events.yoy([(date(2021, 3, 31), 5.0), (date(2022, 3, 31), None)])[1][1] is None


def test_build_events_windows_and_records():
    rates = [(date(2011, 6, 2), 9.0)] + [(date(2012, 1, 5) + timedelta(weeks=i), v) for i, v in enumerate([4.0, 4.5, 5.2, 4.6, 4.1, 3.9, 4.4])]
    rows = [
        {"period_end": d, "median_sale_price": 100 * (1.05 if d.year == 2012 else 1.0), "inventory": 50.0 + d.month}
        for d, _ in _monthly(date(2011, 1, 1), [0] * 24)
    ]
    out = events.build_events(rates, rows, date(2012, 1, 1), date(2012, 12, 31))
    kinds = [e.kind for e in out.events]
    assert "rate_high" in kinds and "rate_low" in kinds
    assert all(e.date >= date(2012, 1, 1) for e in out.events)  # the 2011 9% week is outside the window
    assert out.rules["rate_min_prominence_pp"] == 0.5 and out.since == date(2012, 1, 1)
    assert [e.date for e in out.events] == sorted(e.date for e in out.events)


def test_events_fit_drops_the_least_prominent_rate_turns_first():
    ev = [
        events.NationalEvent(date=date(2020, 1, 1) + timedelta(weeks=i), kind="rate_high" if i % 2 else "rate_low", metric="mortgage30", value=5 + i / 10, prominence=0.5 + i / 10)
        for i in range(10)
    ]
    out = events.EventsOutput(since=date(2020, 1, 1), through=date(2021, 1, 1), rules={}, events=ev)
    size = lambda o: len(o.model_dump_json())  # noqa: E731
    fitted, warnings = events.fit(out, size, size(out) - 150)
    assert fitted is not None and len(fitted.events) < 10 and warnings
    kept = {e.value for e in fitted.events}
    assert {5.0, 5.9} <= kept  # the window's rate low and high survive
    assert ev[1].value not in kept  # the least prominent non-extreme went first
    assert events.fit(out, size, 10) == (None, [f"events.json is {size(out.model_copy(update={'events': [ev[0], ev[9]]}))} bytes (limit 10); not published this run"])


# ---- §6.6 pulse --------------------------------------------------------------

METROS = [
    Metro(slug="a", name="A", redfin_region="A metro area", cbsa=None, lat=None, lon=None),
    Metro(slug="b", name="B", redfin_region="B metro area", cbsa=None, lat=None, lon=None),
    Metro(slug="c", name="C", redfin_region="C metro area", cbsa=None, lat=None, lon=None),
]


def test_pulse_keeps_the_last_weeks_and_computes_yoy_52_weeks_back():
    ends = [date(2025, 1, 5) + timedelta(weeks=i) for i in range(60)]
    rows = [
        {"region": "A metro area", "period_end": d, "median_sale_price": 1000.0 + i, "new_listings": 10.4, "pending_sales": None, "active_listings": 0.0}
        for i, d in enumerate(ends)
    ] + [{"region": "B metro area", "period_end": ends[-1], "median_sale_price": 5.0}, {"region": "Z metro area", "period_end": ends[-1]}]
    out = pulse.build_pulse(rows, METROS, weeks=12)
    assert out is not None and out.weeks == ends[-12:] and out.window_weeks == 4
    assert set(out.metros) == {"a", "b"}  # C has no rows; Z isn't tracked
    assert out.metros["a"]["median_sale_price"] == [1000 + i for i in range(48, 60)]
    assert out.metros["a"]["new_listings"][-1] == 10
    assert out.yoy["a"]["median_sale_price"] == round(1059 / 1007 - 1, 4)
    assert out.yoy["a"]["pending_sales"] is None and out.yoy["a"]["active_listings"] is None  # missing, zero base
    assert out.metros["b"]["median_sale_price"] == [None] * 11 + [5]
    assert out.yoy["b"]["median_sale_price"] is None
    assert pulse.build_pulse([], METROS) is None
    assert pulse.ref(out).count == 2 and pulse.ref(out).through == ends[-1]


# ---- §6.7 areas --------------------------------------------------------------


def test_areas_latest_month_yoy_centroids_and_order():
    through = date(2026, 8, 31)
    rows = [
        {"metro": "A metro area", "region": "Big County, TX", "period_end": date(2026, 8, 31), "median_sale_price": 420000.4, "inventory": 90.0, "homes_sold": 300.0},
        {"metro": "A metro area", "region": "Big County, TX", "period_end": date(2025, 8, 31), "median_sale_price": 400000.0, "inventory": 100.0, "homes_sold": 0.0},
        {"metro": "A metro area", "region": "Small County, TX", "period_end": date(2026, 8, 31), "median_sale_price": None, "inventory": 5.0, "homes_sold": 12.0},
        {"metro": "A metro area", "region": "Old County, TX", "period_end": date(2026, 7, 31), "median_sale_price": 1.0},
        {"metro": "Q metro area", "region": "Q County, TX", "period_end": date(2026, 8, 31), "median_sale_price": 1.0},
    ]
    cents = {"Big County, TX": areas.Centroid("48001", 30.0, -97.0)}
    out = areas.build_areas(rows, METROS, cents, through)
    assert set(out) == {"a"}  # untracked metros and stale-only counties are left out
    big, small = out["a"].areas
    assert (big.name, big.geoid, big.lat, big.lon) == ("Big County, TX", "48001", 30.0, -97.0)
    assert (big.median_sale_price, big.median_sale_price_yoy, big.inventory_yoy) == (420000, 0.05, -0.1)
    assert big.homes_sold_yoy is None  # zero base
    assert (small.lat, small.median_sale_price, small.median_sale_price_yoy) == (None, None, None)
    assert out["a"].data_through == through
    assert areas.refs(out)[0].model_dump() == {"slug": "a", "path": "areas/a.json", "count": 2}


def test_area_budget_drops_a_file_not_counties(tmp_path):
    out = areas.build_areas(
        [{"metro": "A metro area", "region": f"C{i} County, TX", "period_end": date(2026, 8, 31), "homes_sold": float(i)} for i in range(40)],
        METROS,
        {},
        date(2026, 8, 31),
    )
    kept, warnings = areas.fit(out, lambda a: len(a.model_dump_json()), 100)
    assert kept == {} and warnings[0].startswith("areas/a.json is ")
    p = tmp_path / "c.csv"
    p.write_text('# comment\nname,geoid,lat,lon\n"X County, TX",48001,1.5,-2.5\n', encoding="utf8")
    assert areas.load_centroids(p) == {"X County, TX": areas.Centroid("48001", 1.5, -2.5)}
    assert areas.load_centroids(tmp_path / "missing.csv") == {}


def test_the_committed_centroids_cover_every_county_row_shape():
    cents = areas.load_centroids()
    assert len(cents) >= 300
    assert cents["Baltimore City County, MD"].geoid == "24510"  # an independent city, by its Gazetteer spelling
    assert all(24 < c.lat < 50 and -125 < c.lon < -66 for c in cents.values())


# ---- fetchers ------------------------------------------------------------------


@respx.mock
def test_weekly_and_county_fetchers_filter_to_tracked_metros_and_recent_rows(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    today = date.today()
    weeks = [today - timedelta(weeks=k) for k in (70, 3, 2, 1)]
    months = [today.replace(day=1) - timedelta(days=d) for d in (700, 60, 30)]
    respx.get(fetch_redfin.WEEKLY_METRO_URL).mock(
        return_value=httpx.Response(200, content=dc.weekly_csv([("A metro area", {"MEDIAN SALE PRICE NSA ($)": 5}), ("Z metro area", {})], weeks))
    )
    respx.get(fetch_redfin.COUNTY_URL).mock(
        return_value=httpx.Response(200, content=dc.county_csv([("K County, TX", "A metro area", {"HOMES SOLD": 3}), ("L County, OK", "Z metro area", {})], months))
    )
    with Http(cache_dir=tmp_path / "http") as http:
        w = fetch_redfin.fetch_weekly(http, tracked_regions={"A metro area"}, columns=pulse.PULSE_COLUMNS)
        c = fetch_redfin.fetch_counties(http, tracked_regions={"A metro area"}, columns=areas.AREA_COLUMNS)
    wf, cf = pl.read_parquet(w.parquet_path), pl.read_parquet(c.parquet_path)
    assert set(wf["region"]) == {"A metro area"} and wf.height == 3  # the 70-week-old row is outside 420 days
    assert set(wf.columns) == {"period_end", "region", *pulse.PULSE_COLUMNS}
    assert set(cf["region"]) == {"K County, TX"} and cf.height == 2 and cf["homes_sold"].to_list() == [3.0, 3.0]
    assert set(cf.columns) == {"period_end", "metro", "region", *areas.AREA_COLUMNS}


@respx.mock
def test_extension_fetchers_fail_loudly_on_a_changed_layout(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    respx.get(fetch_redfin.WEEKLY_METRO_URL).mock(return_value=httpx.Response(200, content=b'"PERIOD END","REGION NAME"\n"2026-09-20","A"\n'))
    with Http(cache_dir=tmp_path / "http") as http, pytest.raises(fetch_redfin.RedfinColumnsMissing):
        fetch_redfin.fetch_weekly(http, tracked_regions={"A"}, columns=pulse.PULSE_COLUMNS)


def test_schema_refs_are_optional_so_a_1_3_index_still_validates():
    from agents.real_estate.schema import IndexOutput

    fields = IndexOutput.model_fields
    assert fields["events"].default is None and fields["pulse"].default is None
    assert fields["areas"].default_factory is list
    assert json.loads(events.ref(events.EventsOutput(since=date(2012, 1, 1), through=date(2026, 9, 1), rules={}, events=[])).model_dump_json())["path"] == "events.json"


@respx.mock
def test_an_unchanged_file_is_refiltered_when_the_cached_parquet_lacks_a_new_column(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    from agents.real_estate import region

    header = ["PERIOD END", "REGION TYPE", "REGION NAME", "METRO", *region.FETCH_COLUMNS.values()]
    row = [date.today().isoformat(), "zip", "92618", "Anaheim, CA metro area", *["1" for _ in region.FETCH_COLUMNS]]
    csv = (",".join(f'"{h}"' for h in header) + "\n" + ",".join(f'"{v}"' for v in row) + "\n").encode()
    respx.get(fetch_redfin.ZIP_URL).mock(side_effect=[httpx.Response(200, content=csv, headers={"ETag": '"v1"'}), httpx.Response(304), httpx.Response(304)])
    with Http(cache_dir=tmp_path / "http") as http:
        first = fetch_redfin.fetch_zips(http, tracked_regions={"Anaheim, CA metro area"}, columns=region.FETCH_COLUMNS)
        assert first.modified and "median_ppsf" in pl.read_parquet_schema(first.parquet_path)
        # A parquet built before median_ppsf existed: rebuilt from the cached CSV.
        pl.read_parquet(first.parquet_path).drop("median_ppsf").write_parquet(first.parquet_path)
        again = fetch_redfin.fetch_zips(http, tracked_regions={"Anaheim, CA metro area"}, columns=region.FETCH_COLUMNS)
        assert again.modified and "median_ppsf" in pl.read_parquet_schema(again.parquet_path)
        # Up to date: reused.
        assert not fetch_redfin.fetch_zips(http, tracked_regions={"Anaheim, CA metro area"}, columns=region.FETCH_COLUMNS).modified
