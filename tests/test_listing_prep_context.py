"""Listing Prep P3 context: buyer demand by need (ACS; needs-based and fair-housing
clean), nearby public schools (CDE directory) and amenities (OpenStreetMap)."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
import respx
from agents_core.http import Http

from agents.listing_prep import demand, fair_housing, places

FIX = Path(__file__).parent / "fixtures" / "listing_prep"
IRVINE = (33.6875, -117.8263)


# ---------- demand ----------


def acs_table(**overrides: float) -> list[list[str]]:
    codes = demand._codes()
    base = {c: 0.0 for c in codes}
    base.update({"B11016_001E": 1000, "B11016_010E": 250, "B11016_003E": 200, "B11016_011E": 50, "B11016_005E": 150, "B11016_006E": 60,
                 "B08301_001E": 1200, "B08301_021E": 180, "B25003_001E": 1000, "B25003_003E": 400, "B25064_001E": 2900,
                 "B19001_001E": 1000, "B19001_017E": 250, "B25077_001E": 1_100_000})  # fmt: skip
    base.update(overrides)
    return [codes + ["zip code tabulation area"], [str(base[c]) for c in codes] + ["92606"]]


def test_stats_read_shares_and_ignore_the_acs_not_available_code():
    s = demand.stats_from_row(dict(zip(*acs_table(B25064_001E=-666666666), strict=False)))
    assert s is not None
    assert (s.small_households, s.large_households, s.work_from_home, s.renter, s.high_income) == (0.5, 0.21, 0.15, 0.4, 0.25)
    assert s.median_rent is None and s.median_value == 1_100_000
    assert demand.stats_from_row(dict(zip(*acs_table(B11016_001E=0), strict=False))) is None


def test_no_census_variable_touches_a_protected_class():
    # Household size (B11016 totals), commuting from home, tenure, rent, income, value: nothing else.
    assert {c[:6] for c in demand._codes()} == {"B11016", "B08301", "B25003", "B25064", "B19001", "B25077"}


def test_segments_are_needs_based_weighted_and_fair_housing_clean():
    area = demand.AreaStats(0.45, 0.30, 0.14, 0.35, 0.30, 3000, 1_200_000)
    county = demand.AreaStats(0.50, 0.20, 0.12, 0.43, 0.20, 2600, 1_000_000)
    facts = {"beds": 4, "baths": 2.5, "sqft": 2200, "property_type": "single_family", "lot_sqft": 6000, "stories": 2}
    segs = demand.segments(facts, 1_450_000, area, county)
    assert segs[0].key == "more_space"  # 4 beds, big lot, and 50% more large households than the county
    assert sum(s.weight for s in segs) == pytest.approx(1, abs=0.01)
    assert segs == sorted(segs, key=lambda s: s.weight, reverse=True)
    wfh = next(s for s in segs if s.key == "work_from_home")
    assert "14% of workers who work from home in this ZIP vs 12% in the county" in wfh.evidence
    texts = [t for key, (label, needs) in demand.SEGMENTS.items() for t in (key, label, *needs)] + [e for s in segs for e in s.evidence]
    assert [t for t in texts if fair_housing.violations(t)] == []


def test_a_small_single_level_condo_leans_low_maintenance():
    area = county = demand.AreaStats(0.5, 0.2, 0.12, 0.43, 0.2, 2600, 1_000_000)
    segs = demand.segments({"beds": 2, "sqft": 1100, "property_type": "condo", "stories": 1}, 650_000, area, county)
    assert segs[0].key == "low_maintenance"
    assert next((s for s in segs if s.key == "more_space"), None) is None  # 2 bedrooms: no fit


@respx.mock
def test_fetch_acs_needs_a_key_and_reads_zip_and_county(tmp_path):
    with Http(cache_dir=tmp_path) as http:
        assert demand.fetch_acs(http, "92606", api_key="") is None
        route = respx.get(demand.ACS_URL).mock(side_effect=[httpx.Response(200, json=acs_table()), httpx.Response(200, json=acs_table(B08301_021E=100))])
        got = demand.fetch_acs(http, "92606", api_key="test-key")
    assert got is not None and got[0].work_from_home == 0.15 and round(got[1].work_from_home, 4) == round(100 / 1200, 4)
    assert route.calls[0].request.url.params["for"] == "zip code tabulation area:92606"
    assert route.calls[1].request.url.params["in"] == "state:06"


# ---------- schools ----------


def test_the_directory_keeps_regular_active_public_schools_in_the_county():
    schools = places.parse_directory((FIX / "cde_schools_sample.tsv").read_text(encoding="latin-1"))
    assert schools and {s.level for s in schools} <= {"elementary", "middle", "high", "k12"}
    names = {s.name for s in schools}
    assert "Creekside High" not in names and "Irvine Adult" not in names  # continuation and adult programs
    header = (FIX / "cde_schools_sample.tsv").read_text(encoding="latin-1").splitlines()[0]
    assert "AdmFName" not in header and "AdmLName" not in header  # no personal data in the fixture either


def test_nearest_schools_per_level_and_never_called_assigned():
    schools = places.parse_directory((FIX / "cde_schools_sample.tsv").read_text(encoding="latin-1"))
    near = places.nearest_schools(*IRVINE, schools)
    assert [n.level for n in near].count("elementary") <= 2 and {"elementary", "middle", "high"} <= {n.level for n in near}
    for level in ("elementary", "middle", "high"):
        dists = [n.miles for n in near if n.level == level]
        assert dists == sorted(dists)
    assert "assigned" not in (places.nearest_schools.__doc__ or "").replace("never \"assigned\"", "")


# ---------- amenities ----------


def test_amenities_count_and_nearest_from_a_real_overpass_answer():
    data = json.loads((FIX / "overpass_irvine_800m.json").read_text())
    got = {a.kind: a for a in places.summarize_amenities(*IRVINE, data["elements"])}
    assert got["transit"].count == 14 and got["cafe_restaurant"].count == 17 and got["park"].count == 6
    assert got["grocery"].count == 1 and got["grocery"].nearest_miles is not None and got["grocery"].nearest_miles < 0.5
    assert got["rail"].count == 0 and got["rail"].nearest_miles is None


@respx.mock
def test_amenities_query_and_failure(tmp_path):
    q = places.overpass_query(*IRVINE)
    assert q.count("nwr(around:1600,33.687500,-117.826300)") == len(places.AMENITIES)
    respx.get(places.OVERPASS_URL).mock(return_value=httpx.Response(400))
    with Http(cache_dir=tmp_path) as http:
        assert places.amenities(http, *IRVINE) is None


# ---------- insights (the worker's P3 pass) ----------

from agents.listing_prep import insights  # noqa: E402

REGION = {
    "slug": "orange-county",
    "data_through": "2026-08-31",
    "zips": [
        {"id": "92606", "city": "Irvine", "low_sample": False, "latest": {"median_ppsf": {"value": 650}, "median_sale_price": {"value": 1_300_000}}},
        {"id": "92676", "city": "Silverado", "low_sample": True, "latest": {"median_ppsf": {"value": 900}, "median_sale_price": {"value": 1_800_000}}},
    ],
    "cities": [{"id": "0636770", "name": "Irvine", "latest": {"median_ppsf": {"value": 700}}}, {"id": "0672344", "name": "Silverado", "latest": {"median_ppsf": {"value": None}}}],
}
PROP = {"id": "p1", "zip": "92606", "place_id": "0636770", "lat": IRVINE[0], "lon": IRVINE[1], "facts": {"beds": 3, "baths": 2.5, "sqft": 2000, "year_built": 1978, "property_type": "single_family"}}


def test_build_insights_values_the_home_and_says_what_is_missing():
    row = insights.build_insights(PROP, region=REGION, findings=[(2, "cosmetic")], acs=None, schools=[], amenities=None)
    v = row["valuation"]
    assert v["method"] == "zip_ppsf" and v["confidence"] == "low" and v["inputs"]["condition_adjustment"] == 0.97
    assert v["mid"] == round(650 * 2000 * 0.97 / 5000) * 5000
    assert row["segments"] is None and any("CENSUS_API_KEY" in n for n in row["notes"])
    assert any("amenities service was unavailable" in n for n in row["notes"])
    assert any(s.startswith("Redfin") and "2026-08-31" in s for s in row["sources"])
    unpinned = insights.build_insights({**PROP, "lat": None, "lon": None}, region=REGION, findings=[], acs=None, schools=None, amenities=None)
    assert unpinned["schools"] is None and any("No map pin" in n for n in unpinned["notes"])
    outside = insights.build_insights({**PROP, "zip": "90210", "place_id": None}, region=REGION, findings=[], acs=None, schools=None, amenities=None)
    assert outside["valuation"] is None and any("Orange County for now" in n for n in outside["notes"])


def test_build_insights_uses_the_city_for_a_thin_zip_and_area_lookup_by_name():
    z, c = insights.area_for(REGION, "92676", None)
    assert z["id"] == "92676" and c["name"] == "Silverado"
    row = insights.build_insights({**PROP, "zip": "92676", "place_id": None}, region=REGION, findings=[], acs=None, schools=None, amenities=None)
    assert row["valuation"]["inputs"]["ppsf_source"] == "zip" and row["valuation"]["inputs"]["spread"] == 0.25  # no city $/sq ft: the thin ZIP, widened


class InsightsBackend:
    def __init__(self, todo):
        self.todo = todo
        self.rows = []

    def needing_insights(self, limit):
        return self.todo[:limit]

    def reviewed_findings(self, property_id):
        return [(4, "cosmetic")]

    def upsert_insights(self, row):
        self.rows.append(row)


@respx.mock
def test_insights_pass_fetches_once_and_stores_a_row_per_property(tmp_path, monkeypatch):
    monkeypatch.delenv("CENSUS_API_KEY", raising=False)
    respx.get(insights.REGION_DATA_URL).mock(return_value=httpx.Response(200, json=REGION))
    cde = respx.get(places.CDE_URL).mock(return_value=httpx.Response(200, content=(FIX / "cde_schools_sample.tsv").read_bytes()))
    respx.get(places.OVERPASS_URL).mock(return_value=httpx.Response(200, json=json.loads((FIX / "overpass_irvine_800m.json").read_text())))
    backend = InsightsBackend([PROP, {**PROP, "id": "p2", "lat": None, "lon": None}])
    monkeypatch.setattr(places.settings, "data_dir", lambda: tmp_path)
    with Http(cache_dir=tmp_path / "http") as http:
        assert insights.insights_pass(backend, http) == 2
    assert cde.call_count == 1
    first, second = backend.rows
    assert first["valuation"]["inputs"]["condition_adjustment"] == 1.03
    assert first["schools"] and {s["level"] for s in first["schools"]} >= {"elementary", "high"}
    assert {a["kind"] for a in first["amenities"]} == set(places.AMENITIES)
    assert second["schools"] is None and second["amenities"] is None
    assert insights.insights_pass(InsightsBackend([]), Http(cache_dir=tmp_path / "h2")) == 0
