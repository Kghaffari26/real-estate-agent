"""v3 §4.2 regions: roll-ups, change rules, missing data and geometry, budgets."""

from __future__ import annotations

from datetime import date

import pytest

from agents.real_estate import region
from agents.real_estate.config import RegionConfig, load_regions
from agents.real_estate.schema import RegionGeometry

CFG = RegionConfig(slug="oc", name="Orange County, CA", metros=("anaheim-ca",), geometry="nowhere.geo.json")
THROUGH = date(2026, 8, 31)


def _months(n: int) -> list[date]:
    out, y, m = [], 2026, 8
    for _ in range(n):
        out.append(region.month_end(date(y, m, 1)))
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return out[::-1]


def rows(z: str, metro: str = "Anaheim, CA metro area", **values):
    return [{"metro": metro, "zip": z, "period_end": d, **{k: (v(i) if callable(v) else v) for k, v in values.items()}} for i, d in enumerate(_months(26))]


def test_aggregate_sums_counts_and_weights_the_rest():
    got = region.aggregate({
        "a": {"homes_sold": 30.0, "median_sale_price": 500.0, "inventory": 10.0, "median_dom": 20.0, "new_listings": None, "avg_sale_to_list": 1.0, "sold_above_list": None, "off_market_in_two_weeks": None, "months_of_supply": 2.0},
        "b": {"homes_sold": 10.0, "median_sale_price": 300.0, "inventory": None, "median_dom": 40.0, "new_listings": None, "avg_sale_to_list": 0.96, "sold_above_list": None, "off_market_in_two_weeks": None, "months_of_supply": 4.0},
        "c": {"homes_sold": 0.0, "median_sale_price": 9e9, "inventory": 5.0, "median_dom": 999.0, "new_listings": None, "avg_sale_to_list": None, "sold_above_list": None, "off_market_in_two_weeks": None, "months_of_supply": None},
    })  # fmt: skip
    assert got["homes_sold"] == 40 and got["inventory"] == 15 and got["new_listings"] is None
    assert got["median_sale_price"] == pytest.approx((500 * 30 + 300 * 10) / 40)  # c has no sales: no weight
    assert got["median_dom"] == pytest.approx(25) and got["months_of_supply"] == pytest.approx(2.5)
    assert got["sold_above_list"] is None


def test_build_region_zips_cities_ranks_and_missing_geometry():
    data = [
        *rows("92618", median_sale_price=lambda i: 1_000_000 + 10_000 * i, homes_sold=50, median_dom=lambda i: 30 - i % 3, sold_above_list=25.0),
        *rows("92602", median_sale_price=900_000, homes_sold=10, median_dom=15),
        *rows("99999", metro="Elsewhere, TX metro area", median_sale_price=1),
        # a ZIP that stopped reporting before the latest month is left out
        *[r for r in rows("92000", median_sale_price=1, homes_sold=1) if r["period_end"] < date(2026, 1, 1)],
    ]
    geo = region.GeoInfo(zips={"92618": ("Irvine", 33.67, -117.73), "92602": ("Irvine", 33.74, -117.75)}, cities={"Irvine": ("0636770", 33.68, -117.77)})
    out = region.build_region(data, CFG, {"Anaheim, CA metro area"}, geo, THROUGH)
    assert out is not None
    assert [z.id for z in out.zips] == ["92602", "92618"] and len(out.dates) == 36 and out.dates[-1] == THROUGH
    irv = next(z for z in out.zips if z.id == "92618")
    assert irv.latest["median_sale_price"].value == 1_250_000
    assert irv.latest["median_sale_price"].yoy == round(1_250_000 / 1_130_000 - 1, 4)
    assert irv.latest["sold_above_list"].value == 0.25 and irv.latest["sold_above_list"].yoy == 0.0  # pp: a difference
    assert irv.series["median_sale_price"][-1] == 1_250_000 and irv.series["median_sale_price"][0] is None  # 26 of 36 months
    assert irv.ranks["median_sale_price"] == 1 and next(z for z in out.zips if z.id == "92602").ranks["median_dom"] == 1
    assert not irv.low_sample
    [city] = out.cities
    assert (city.id, city.zips, city.lat) == ("0636770", ["92602", "92618"], 33.68)
    assert city.latest["homes_sold"].value == 60
    # Without geometry, ZIPs publish without a city or a centroid, and no city is built.
    bare = region.build_region(data, CFG, {"Anaheim, CA metro area"}, region.GeoInfo({}, {}), THROUGH)
    assert bare is not None and bare.cities == [] and bare.zips[0].lat is None
    assert region.build_region(data, CFG, {"Anaheim, CA metro area"}, geo, date(2027, 1, 31)) is None  # no rows that month


def test_geometry_loading_budget_and_ref(tmp_path):
    assert region.load_geometry(tmp_path / "missing.geo.json") is None
    g = RegionGeometry(features=[{"type": "Feature", "geometry": None, "properties": {"kind": "zip", "id": "92618", "city": "Irvine", "lat": 1.0, "lon": 2.0}}, {"type": "Feature", "geometry": None, "properties": {"kind": "city", "id": "0636770", "name": "Irvine", "lat": 3.0, "lon": 4.0}}])
    info = region.geo_info(g)
    assert info.zips["92618"] == ("Irvine", 1.0, 2.0) and info.cities["Irvine"] == ("0636770", 3.0, 4.0)
    out = region.build_region(rows("92618", median_sale_price=1.0, homes_sold=1.0), CFG, {"Anaheim, CA metro area"}, info, THROUGH)
    assert region.fit(out, lambda o: 10**9, 100)[0] is None
    assert region.ref(out, geometry_published=False).model_dump() == {"slug": "oc", "name": "Orange County, CA", "path": "regions/oc.json", "geometry": None, "zips": 1, "cities": 1, "through": THROUGH}


def test_the_committed_orange_county_config_and_geometry():
    [oc] = load_regions()
    assert (oc.slug, oc.metros) == ("orange-county", ("anaheim-ca",))
    info = region.geo_info(region.load_geometry(oc.geometry))
    assert len(info.zips) >= 85 and info.zips["92618"][0] == "Irvine" and info.zips["92660"][0] == "Newport Beach"
    assert all(33.3 < lat < 34.0 and -118.2 < lon < -117.4 for _, lat, lon in info.zips.values() if lat is not None)
    assert region.geometry_size(region.load_geometry(oc.geometry)) < 450 * 1024


def test_low_sample_areas_are_flagged_and_unranked():
    data = [*rows("92657", median_sale_price=8_000_000, homes_sold=3), *rows("92618", median_sale_price=1_000_000, homes_sold=40)]
    geo = region.GeoInfo(zips={"92657": ("Newport Beach", 33.6, -117.8), "92618": ("Irvine", 33.67, -117.73)}, cities={})
    out = region.build_region(data, CFG, {"Anaheim, CA metro area"}, geo, THROUGH)
    rich = next(z for z in out.zips if z.id == "92657")
    assert rich.low_sample and rich.ranks == {}
    assert next(z for z in out.zips if z.id == "92618").ranks["median_sale_price"] == 1  # the 3-sale ZIP doesn't outrank it


def test_median_ppsf_is_published_per_zip_and_weighted_per_city():
    data = [
        *rows("92618", median_sale_price=1_000_000, homes_sold=30, median_ppsf=lambda i: 600 + i),
        *rows("92602", median_sale_price=900_000, homes_sold=10, median_ppsf=500),
    ]
    geo = region.GeoInfo(zips={"92618": ("Irvine", 33.67, -117.73), "92602": ("Irvine", 33.74, -117.75)}, cities={"Irvine": ("0636770", 33.68, -117.77)})
    out = region.build_region(data, CFG, {"Anaheim, CA metro area"}, geo, THROUGH)
    assert out is not None
    irv = next(z for z in out.zips if z.id == "92618")
    assert irv.latest["median_ppsf"].value == 625 and irv.latest["median_ppsf"].yoy == round(625 / 613 - 1, 4)
    [city] = out.cities
    assert city.latest["median_ppsf"].value == round((625 * 30 + 500 * 10) / 40)
    assert "median_ppsf" not in irv.series  # latest only: the valuation needs the level, not the history
