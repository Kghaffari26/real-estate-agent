from __future__ import annotations

from agents.real_estate import templates

BASE_FACTS = {
    "metro": "Austin, TX",
    "data_through": "August 2026",
    "metrics": {
        "median_sale_price": {"value": 550000, "yoy_pct": 9.4},
        "inventory": {"value": 4200, "yoy_pct": -18.2},
        "median_dom": {"value": 12, "yoy_days": -8},
    },
    "temperature": {"label": "Hot", "score": 91, "relative_to": "50 largest metros"},
    "flags": [],
}


def test_metro_brief_mentions_price_and_inventory():
    result = templates.metro_brief(BASE_FACTS)
    assert "550,000" in result["text"]
    assert "9.4%" in result["text"]
    assert "18.2%" in result["text"]
    assert "Hot" in result["text"]


def test_metro_brief_has_no_flag_sentence_when_flags_empty():
    result = templates.metro_brief(BASE_FACTS)
    assert "Other notable signals" not in result["text"]


def test_metro_brief_names_flags_not_already_covered():
    facts = {**BASE_FACTS, "flags": ["Crossed into a seller's market", "Price cuts at a 36-month high"]}
    result = templates.metro_brief(facts)
    assert "Other notable signals" in result["text"]
    assert "Crossed into a seller's market" in result["text"]
    assert "Price cuts at a 36-month high" in result["text"]


def test_metro_brief_skips_flags_already_covered_by_price_or_inventory():
    facts = {**BASE_FACTS, "flags": ["Median price +9.4% YoY", "Inventory -18% YoY"]}
    result = templates.metro_brief(facts)
    # Both flags are already narrated by the price/inventory sentences, so the
    # extra sentence should be omitted entirely rather than repeating them.
    assert "Other notable signals" not in result["text"]


def test_headline_picks_larger_magnitude_change():
    text = templates.headline(
        inventory_national_yoy=0.14, price_national_yoy=0.02, price_drops_count=31, total_metros=50
    )
    assert "Inventory" in text
    assert "31 of 50" in text

    text2 = templates.headline(
        inventory_national_yoy=0.01, price_national_yoy=0.05, price_drops_count=None, total_metros=50
    )
    assert "Median sale prices" in text2
