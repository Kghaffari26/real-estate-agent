"""Fixture properties for the report agent (Listing Prep P5). **All fictional**: no real
home, seller or team. The market figures are shaped like the published Orange County
region data (`latest`: ratios for shares, `yoy` in the registry's change kinds), the
cost book and value priors like a filled team table, the findings like confirmed P2
findings, and the insights like `property_insights` rows. Each world exercises one
situation the report must handle honestly.

    full          a dated single-family home with everything available
    condo-small   a small condo, a $5K budget and two weeks to list
    no-priors     the team hasn't filled its value priors: "not enough evidence"
    no-demand     no Census key and no map pin: demand, schools and amenities missing
    rushed        three days to list and only two rooms photographed
    no-value      the living area isn't confirmed: no value range
"""

from __future__ import annotations

from typing import Any

from agents.listing_prep.report import Goal, ReportWorld

PRIOR_SOURCE = "Fixture team prior (fictional, for tests)"

COST_BOOK: dict[str, dict[str, Any]] = {
    "interior_paint_walls": {"unit": "sq_ft_floor_area", "low": 2.5, "high": 4.0},
    "interior_paint_trim_doors": {"unit": "door", "low": 90, "high": 140},
    "exterior_paint": {"unit": "sq_ft_floor_area", "low": 3.0, "high": 5.0},
    "cabinet_refinish": {"unit": "linear_ft", "low": 150, "high": 250},
    "cabinet_hardware": {"unit": "piece", "low": 8, "high": 15},
    "countertop_quartz_install": {"unit": "sq_ft", "low": 75, "high": 120},
    "kitchen_faucet_sink": {"unit": "each", "low": 400, "high": 900},
    "bath_vanity_replace": {"unit": "each", "low": 900, "high": 1800},
    "bath_regrout_recaulk": {"unit": "each", "low": 250, "high": 450},
    "bath_fixtures_update": {"unit": "each", "low": 300, "high": 650},
    "flooring_lvp": {"unit": "sq_ft", "low": 6.0, "high": 9.0},
    "flooring_carpet": {"unit": "sq_ft", "low": 4.0, "high": 6.0},
    "light_fixture_replace": {"unit": "each", "low": 150, "high": 350},
    "landscaping_refresh": {"unit": "sq_ft_yard", "low": 2.0, "high": 4.0},
    "front_door_replace_or_paint": {"unit": "each", "low": 300, "high": 1200},
    "exterior_lighting": {"unit": "each", "low": 120, "high": 260},
    "minor_repairs_handyman": {"unit": "hour", "low": 80, "high": 120},
    "staging_partial": {"unit": "month", "low": 1500, "high": 2500},
    "staging_full": {"unit": "month", "low": 3000, "high": 5000},
    "professional_cleaning": {"unit": "each", "low": 400, "high": 700},
    "pressure_washing": {"unit": "each", "low": 250, "high": 450},
}

PRIORS: dict[str, dict[str, Any]] = {
    k: {"recovery_low": lo, "recovery_high": hi, "source": PRIOR_SOURCE}
    for k, (lo, hi) in {
        "interior_paint_walls": (1.1, 1.6),
        "interior_paint_trim_doors": (0.8, 1.2),
        "exterior_paint": (0.9, 1.3),
        "cabinet_refinish": (0.9, 1.4),
        "cabinet_hardware": (1.0, 1.5),
        "countertop_quartz_install": (0.6, 0.9),
        "kitchen_faucet_sink": (0.7, 1.1),
        "bath_vanity_replace": (0.6, 0.95),
        "bath_regrout_recaulk": (1.2, 1.8),
        "bath_fixtures_update": (0.8, 1.2),
        "flooring_lvp": (1.05, 1.5),
        "flooring_carpet": (0.8, 1.2),
        "light_fixture_replace": (1.05, 1.4),
        "landscaping_refresh": (1.2, 1.9),
        "front_door_replace_or_paint": (1.0, 1.6),
        "exterior_lighting": (0.9, 1.3),
        "staging_partial": (1.3, 2.2),
        "staging_full": (1.1, 2.0),
        "professional_cleaning": (1.5, 2.5),
        "pressure_washing": (1.3, 2.0),
    }.items()
}


def _market(price: float, yoy: float, ppsf: float, dom: int, stl: float, inv_yoy: float, mos: float) -> dict[str, dict[str, float | None]]:
    return {
        "median_sale_price": {"value": price, "yoy": yoy},
        "median_ppsf": {"value": ppsf, "yoy": yoy - 0.004},
        "homes_sold": {"value": 41, "yoy": -0.068},
        "inventory": {"value": 58, "yoy": inv_yoy},
        "median_dom": {"value": dom, "yoy": 4.0},
        "avg_sale_to_list": {"value": stl, "yoy": -0.0061},
        "sold_above_list": {"value": 0.384, "yoy": -0.052},
        "months_of_supply": {"value": mos, "yoy": 0.6},
    }


def _valuation(low: int, high: int, ppsf: float, sqft: int) -> dict[str, Any]:
    return {
        "low": low,
        "high": high,
        "method": "zip_ppsf",
        "confidence": "low",
        "interval": "rough",
        "mid": None,
        "coverage_target": None,
        "measured_coverage": None,
        "notes": ["A rough range from the ZIP's median price per square foot; comparable sales will narrow it."],
        "inputs": {"zip_ppsf": ppsf, "sqft": sqft, "spread": 0.15},
    }


SEGMENTS = [
    {"key": "more_space", "label": "More space", "weight": 0.38, "priorities": ["bedroom count and size", "storage and closets", "a usable yard", "a flexible bonus room"], "evidence": ["31% (±4%) of households of 4 or more in this ZIP vs 27% in the county"], "reliable": True, "reliability": None},
    {"key": "work_from_home", "label": "Work from home", "weight": 0.29, "priorities": ["a quiet room that works as an office", "good natural light", "strong internet readiness", "built-in desk or shelving"], "evidence": ["17% (±3%) of workers who work from home in this ZIP vs 12% in the county"], "reliable": True, "reliability": None},
    {"key": "low_maintenance", "label": "Single-level, low-maintenance living", "weight": 0.21, "priorities": ["single-level or main-floor bedroom", "low-maintenance finishes and landscaping", "updated kitchen and baths", "move-in ready condition"], "evidence": ["52% (±5%) of households of 1 or 2 in this ZIP vs 50% in the county"], "reliable": False, "reliability": "Not statistically different from the county (90% confidence)."},
    {"key": "luxury", "label": "Luxury", "weight": 0.12, "priorities": ["high-end finishes", "outdoor living space", "privacy", "statement kitchen and primary suite"], "evidence": ["this price is 1.6× the county’s median home value"], "reliable": True, "reliability": None},
]
SCHOOLS = [
    {"name": "Fixture Elementary", "level": "elementary", "grades": "K-6", "charter": False, "miles": 0.4},
    {"name": "Fixture Middle", "level": "middle", "grades": "7-8", "charter": False, "miles": 1.1},
    {"name": "Fixture High", "level": "high", "grades": "9-12", "charter": False, "miles": 1.8},
]
AMENITIES = [
    {"kind": "grocery", "count": 3, "nearest_miles": 0.6},
    {"kind": "park", "count": 5, "nearest_miles": 0.2},
    {"kind": "transit", "count": 9, "nearest_miles": 0.1},
    {"kind": "cafe_restaurant", "count": 14, "nearest_miles": 0.5},
]
SOURCES = [
    "Redfin ZIP and city medians, data through 2026-08-31",
    "U.S. Census Bureau, American Community Survey 2023 5-year estimates",
    "California Department of Education, public school directory (nearest by distance; not attendance boundaries)",
    "© OpenStreetMap contributors (ODbL)",
]
ALL_ROOMS = ["exterior_front", "exterior_back", "yard", "entry", "living", "family", "dining", "kitchen", "primary_bedroom", "bedroom", "primary_bath", "bath"]


def _f(room: str, category: str, condition: int, issue: str, fix: str | None, item: str | None, qty: float | None = None, severity: str = "cosmetic") -> dict[str, Any]:
    return {"room": room, "category": category, "condition": condition, "issue": issue, "suggested_fix": fix, "fix_item": item, "quantity": qty, "severity": severity, "status": "confirmed"}


DATED_FINDINGS = [
    _f("living", "paint", 2, "Scuffed, faded walls with nail holes", "Patch and repaint the walls", "interior_paint_walls"),
    _f("family", "flooring", 2, "Worn carpet with visible traffic paths", "Replace with luxury vinyl plank", "flooring_lvp", 620),
    _f("kitchen", "cabinets", 2, "Dated oak cabinets with worn finish", "Refinish the cabinets", "cabinet_refinish", 22),
    _f("kitchen", "fixtures_hardware", 3, "Mismatched brass pulls", "New cabinet hardware", "cabinet_hardware", 34),
    _f("kitchen", "countertops", 2, "Tile counters with stained grout", "Quartz countertops", "countertop_quartz_install", 48),
    _f("dining", "lighting", 2, "Dated brass chandelier", "Replace the light fixture", "light_fixture_replace"),
    _f("entry", "lighting", 3, "Dim flush-mount light", "Replace the light fixture", "light_fixture_replace"),
    _f("primary_bath", "bath", 2, "Discolored grout around the tub", "Regrout and recaulk", "bath_regrout_recaulk"),
    _f("primary_bath", "bath", 2, "Cracked laminate vanity top", "Replace the vanity", "bath_vanity_replace"),
    _f("yard", "landscaping", 2, "Patchy lawn and overgrown shrubs", "Refresh the landscaping", "landscaping_refresh", 900),
    _f("exterior_front", "curb_appeal", 3, "Faded front door paint", "Paint the front door", "front_door_replace_or_paint"),
    _f("primary_bedroom", "decluttering", 3, "Crowded with furniture and personal items", "Declutter and stage", "staging_partial"),
]

WORLDS: dict[str, ReportWorld] = {
    "full": ReportWorld(
        zip="92618",
        city="Irvine",
        facts={"beds": 4, "baths": 2.5, "sqft": 2150, "lot_sqft": 6000, "year_built": 1978, "property_type": "single_family", "stories": 2, "garage_spaces": 2, "pool": False},
        goal=Goal(target_price=1_450_000, budget=25_000, days_to_list=30),
        data_through="2026-08-31",
        zip_market=_market(1_385_000, 0.0312, 655.0, 31, 0.9912, 0.214, 2.6),
        city_market=_market(1_420_000, 0.0241, 690.0, 33, 0.9894, 0.187, 2.8),
        valuation=_valuation(1_195_000, 1_615_000, 655.0, 2150),
        segments=SEGMENTS,
        schools=SCHOOLS,
        amenities=AMENITIES,
        sources=SOURCES,
        findings=DATED_FINDINGS,
        rooms_photographed=ALL_ROOMS,
        cost_book=COST_BOOK,
        priors=PRIORS,
        quotes=[{"item": "countertop_quartz_install", "low_usd": 4200, "high_usd": 5600}],
    ),
    "condo-small": ReportWorld(
        zip="92612",
        city="Irvine",
        facts={"beds": 2, "baths": 2, "sqft": 1050, "year_built": 1986, "property_type": "condo", "stories": 1, "garage_spaces": 1, "hoa_monthly": 425},
        goal=Goal(target_price=760_000, budget=5_000, days_to_list=14),
        data_through="2026-08-31",
        zip_market=_market(742_000, 0.0187, 702.0, 27, 0.9951, 0.163, 2.2),
        city_market=_market(1_420_000, 0.0241, 690.0, 33, 0.9894, 0.187, 2.8),
        valuation=_valuation(630_000, 855_000, 702.0, 1050),
        segments=[SEGMENTS[2] | {"weight": 0.55, "reliable": True, "reliability": None}, SEGMENTS[1] | {"weight": 0.45}],
        schools=SCHOOLS[:2],
        amenities=AMENITIES,
        sources=SOURCES,
        findings=[
            _f("living", "paint", 3, "Marked walls behind the sofa", "Touch up and repaint", "interior_paint_walls"),
            _f("kitchen", "lighting", 2, "Fluorescent box light", "Replace the light fixture", "light_fixture_replace"),
            _f("bath", "bath", 2, "Mildewed caulk at the tub", "Regrout and recaulk", "bath_regrout_recaulk"),
            _f("primary_bedroom", "flooring", 2, "Stained carpet", "Replace the carpet", "flooring_carpet", 180),
        ],
        rooms_photographed=["exterior_front", "living", "kitchen", "primary_bedroom", "primary_bath", "bath"],
        cost_book=COST_BOOK,
        priors=PRIORS,
    ),
    "no-priors": ReportWorld(
        zip="92618",
        city="Irvine",
        facts={"beds": 4, "baths": 2.5, "sqft": 2150, "lot_sqft": 6000, "year_built": 1978, "property_type": "single_family", "stories": 2},
        goal=Goal(target_price=1_450_000, budget=25_000, days_to_list=30),
        data_through="2026-08-31",
        zip_market=_market(1_385_000, 0.0312, 655.0, 31, 0.9912, 0.214, 2.6),
        valuation=_valuation(1_195_000, 1_615_000, 655.0, 2150),
        segments=SEGMENTS,
        schools=SCHOOLS,
        amenities=AMENITIES,
        sources=SOURCES,
        findings=DATED_FINDINGS[:6],
        rooms_photographed=ALL_ROOMS,
        cost_book=COST_BOOK,
        priors={},
    ),
    "no-demand": ReportWorld(
        zip="92805",
        city="Anaheim",
        facts={"beds": 3, "baths": 2, "sqft": 1480, "lot_sqft": 6200, "year_built": 1958, "property_type": "single_family", "stories": 1},
        goal=Goal(target_price=935_000, budget=10_000, days_to_list=21),
        data_through="2026-08-31",
        zip_market=_market(905_000, -0.0084, 640.0, 38, 0.9861, 0.291, 3.1),
        zip_low_sample=True,
        city_market=_market(925_000, 0.0103, 628.0, 35, 0.9902, 0.224, 2.9),
        valuation=_valuation(780_000, 1_115_000, 640.0, 1480),
        segments=None,
        schools=None,
        amenities=None,
        insight_notes=["Buyer demand needs the Census key (CENSUS_API_KEY) or the Census service was unavailable.", "No map pin (the address wasn’t matched), so schools and amenities aren’t listed."],
        sources=SOURCES[:1],
        findings=[
            _f("kitchen", "appliances", 2, "Mismatched older appliances", None, None),
            _f("living", "flooring", 2, "Scratched laminate", "Replace with luxury vinyl plank", "flooring_lvp", 420),
            _f("exterior_front", "exterior", 2, "Peeling exterior paint on the trim", "Repaint the exterior", "exterior_paint", None, "minor_repair"),
            _f("yard", "landscaping", 2, "Dead lawn", "Refresh the landscaping", "landscaping_refresh", 1200),
        ],
        rooms_photographed=["exterior_front", "yard", "living", "kitchen", "primary_bedroom", "primary_bath"],
        cost_book=COST_BOOK,
        priors=PRIORS,
    ),
    "rushed": ReportWorld(
        zip="92618",
        city="Irvine",
        facts={"beds": 3, "baths": 2, "sqft": 1720, "year_built": 1984, "property_type": "townhouse", "stories": 2},
        goal=Goal(target_price=1_150_000, budget=15_000, days_to_list=3),
        data_through="2026-08-31",
        zip_market=_market(1_385_000, 0.0312, 655.0, 31, 0.9912, 0.214, 2.6),
        valuation=_valuation(955_000, 1_295_000, 655.0, 1720),
        segments=SEGMENTS[:3],
        schools=SCHOOLS,
        amenities=AMENITIES,
        sources=SOURCES,
        findings=[
            _f("kitchen", "cabinets", 2, "Worn cabinet finish", "Refinish the cabinets", "cabinet_refinish", 16),
            _f("kitchen", "cleaning", 3, "Greasy range hood and backsplash", "Deep clean", "professional_cleaning"),
            _f("exterior_front", "curb_appeal", 3, "Dirty walkway and entry", "Pressure wash", "pressure_washing"),
        ],
        rooms_photographed=["exterior_front", "kitchen"],
        cost_book=COST_BOOK,
        priors=PRIORS,
    ),
    "no-value": ReportWorld(
        zip="92612",
        city="Irvine",
        facts={"beds": 3, "baths": 2, "year_built": 1990, "property_type": "condo", "stories": 1},
        goal=Goal(budget=10_000, days_to_list=30),
        data_through="2026-08-31",
        zip_market=_market(742_000, 0.0187, 702.0, 27, 0.9951, 0.163, 2.2),
        valuation=None,
        segments=SEGMENTS[1:3],
        schools=SCHOOLS[:1],
        amenities=AMENITIES[:2],
        insight_notes=["The living area isn’t confirmed, so no value range yet."],
        sources=SOURCES,
        findings=[
            _f("living", "paint", 2, "Smoke-stained walls", "Repaint the walls", "interior_paint_trim_doors", 6),
            _f("kitchen", "lighting", 2, "Dated pendant lights", "Replace the light fixtures", "light_fixture_replace", 3),
        ],
        rooms_photographed=["exterior_front", "living", "kitchen", "primary_bedroom", "primary_bath"],
        cost_book=COST_BOOK,
        priors=PRIORS,
    ),
}
