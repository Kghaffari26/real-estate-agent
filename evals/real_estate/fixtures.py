"""12 metro facts dicts (SPEC_REAL_ESTATE.md §7.2 shape) covering hot, cold,
flat, missing-Zillow, and big-inventory-surge scenarios, plus 2 national
facts dicts, for `evals/real_estate/run.py`.

These evaluate whatever's behind `analyze.generate_metro_brief`/
`generate_national_brief` today — currently always the deterministic
templates (`narrative_source: "template"`), since no LLM path is wired up
yet (see STATUS.md). The fixtures and checks don't assume which one it is.
"""

from __future__ import annotations

from typing import Any

METRO_FACTS: list[dict[str, Any]] = [
    {  # 1. hot market
        "metro": "Austin, TX",
        "data_through": "August 2026",
        "metrics": {
            "median_sale_price": {"value": 550000, "yoy_pct": 9.4},
            "inventory": {"value": 4200, "yoy_pct": -18.2},
            "median_dom": {"value": 12, "yoy_days": -8},
            "price_drops_share_pct": {"value": 3.1, "yoy_pp": -2.0},
            "sale_to_list_pct": {"value": 103.2, "yoy_pp": 1.5},
            "months_of_supply": {"value": 1.8, "yoy": -0.6},
        },
        "temperature": {"label": "Hot", "score": 91, "relative_to": "50 largest metros"},
        "market_type": "Seller's market",
        "flags": ["Median price +9.4% YoY", "Crossed into a seller's market"],
        "rates": {"mortgage30_pct": 6.18, "mortgage30_year_ago_pct": 6.35},
        "affordability": {"payment_now": 2789, "payment_change_pct": 7.1},
    },
    {  # 2. cold market
        "metro": "Baton Rouge, LA",
        "data_through": "August 2026",
        "metrics": {
            "median_sale_price": {"value": 245000, "yoy_pct": -9.2},
            "inventory": {"value": 3100, "yoy_pct": 33.0},
            "median_dom": {"value": 78, "yoy_days": 15},
            "price_drops_share_pct": {"value": 18.4, "yoy_pp": 5.2},
            "sale_to_list_pct": {"value": 93.1, "yoy_pp": -2.1},
            "months_of_supply": {"value": 7.9, "yoy": 2.1},
        },
        "temperature": {"label": "Cold", "score": 6, "relative_to": "50 largest metros"},
        "market_type": "Buyer's market",
        "flags": ["Median price -9.2% YoY", "Inventory +33% YoY", "Crossed into a buyer's market"],
        "rates": {"mortgage30_pct": 6.18, "mortgage30_year_ago_pct": 6.35},
        "affordability": {"payment_now": 1245, "payment_change_pct": -11.4},
    },
    {  # 3. flat market
        "metro": "Columbus, OH",
        "data_through": "August 2026",
        "metrics": {
            "median_sale_price": {"value": 300000, "yoy_pct": 0.1},
            "inventory": {"value": 5000, "yoy_pct": -0.3},
            "median_dom": {"value": 30, "yoy_days": 0},
            "price_drops_share_pct": {"value": 8.0, "yoy_pp": 0.1},
            "sale_to_list_pct": {"value": 99.0, "yoy_pp": 0.0},
            "months_of_supply": {"value": 3.5, "yoy": 0.0},
        },
        "temperature": {"label": "Balanced", "score": 51, "relative_to": "50 largest metros"},
        "market_type": "Balanced",
        "flags": [],
        "rates": {"mortgage30_pct": 6.18, "mortgage30_year_ago_pct": 6.35},
        "affordability": {"payment_now": 1521, "payment_change_pct": 0.2},
    },
    {  # 4. missing Zillow data (no zori_rent key)
        "metro": "Boise, ID",
        "data_through": "August 2026",
        "metrics": {
            "median_sale_price": {"value": 480000, "yoy_pct": 1.9},
            "inventory": {"value": 2100, "yoy_pct": 6.4},
            "median_dom": {"value": 45, "yoy_days": 4},
            "price_drops_share_pct": {"value": 10.2, "yoy_pp": 1.1},
            "sale_to_list_pct": {"value": 97.5, "yoy_pp": -0.3},
            "months_of_supply": {"value": 4.2, "yoy": 0.4},
        },
        "temperature": {"label": "Balanced", "score": 44, "relative_to": "50 largest metros"},
        "market_type": "Balanced",
        "flags": [],
        "rates": {"mortgage30_pct": 6.18, "mortgage30_year_ago_pct": 6.35},
        "affordability": {"payment_now": 2432, "payment_change_pct": 1.5},
    },
    {  # 5. big inventory surge
        "metro": "Cape Coral, FL",
        "data_through": "August 2026",
        "metrics": {
            "median_sale_price": {"value": 360000, "yoy_pct": -3.5},
            "inventory": {"value": 8900, "yoy_pct": 58.3},
            "median_dom": {"value": 65, "yoy_days": 20},
            "price_drops_share_pct": {"value": 22.0, "yoy_pp": 7.0},
            "sale_to_list_pct": {"value": 94.0, "yoy_pp": -1.8},
            "months_of_supply": {"value": 8.5, "yoy": 3.5},
        },
        "temperature": {"label": "Cold", "score": 9, "relative_to": "50 largest metros"},
        "market_type": "Buyer's market",
        "flags": ["Inventory +58% YoY", "Median price -3.5% YoY"],
        "rates": {"mortgage30_pct": 6.18, "mortgage30_year_ago_pct": 6.35},
        "affordability": {"payment_now": 1837, "payment_change_pct": -4.9},
        "metrics_zori": None,
    },
    {  # 6. buyer's market crossing this month
        "metro": "San Antonio, TX",
        "data_through": "August 2026",
        "metrics": {
            "median_sale_price": {"value": 310000, "yoy_pct": -0.6},
            "inventory": {"value": 6600, "yoy_pct": 4.0},
            "median_dom": {"value": 52, "yoy_days": 6},
            "price_drops_share_pct": {"value": 12.5, "yoy_pp": 1.0},
            "sale_to_list_pct": {"value": 96.5, "yoy_pp": -0.2},
            "months_of_supply": {"value": 6.1, "yoy": 0.9},
        },
        "temperature": {"label": "Cool", "score": 22, "relative_to": "50 largest metros"},
        "market_type": "Buyer's market",
        "flags": ["Crossed into a buyer's market"],
        "rates": {"mortgage30_pct": 6.18, "mortgage30_year_ago_pct": 6.35},
        "affordability": {"payment_now": 1553, "payment_change_pct": -0.8},
    },
    {  # 7. seller's market crossing this month
        "metro": "Providence, RI",
        "data_through": "August 2026",
        "metrics": {
            "median_sale_price": {"value": 465000, "yoy_pct": 4.2},
            "inventory": {"value": 1400, "yoy_pct": -12.0},
            "median_dom": {"value": 18, "yoy_days": -5},
            "price_drops_share_pct": {"value": 5.0, "yoy_pp": -1.0},
            "sale_to_list_pct": {"value": 101.8, "yoy_pp": 0.9},
            "months_of_supply": {"value": 2.9, "yoy": -0.4},
        },
        "temperature": {"label": "Warm", "score": 74, "relative_to": "50 largest metros"},
        "market_type": "Seller's market",
        "flags": ["Crossed into a seller's market"],
        "rates": {"mortgage30_pct": 6.18, "mortgage30_year_ago_pct": 6.35},
        "affordability": {"payment_now": 2354, "payment_change_pct": 2.0},
    },
    {  # 8. price cuts at 36-month high
        "metro": "Phoenix, AZ",
        "data_through": "August 2026",
        "metrics": {
            "median_sale_price": {"value": 440000, "yoy_pct": -1.2},
            "inventory": {"value": 12000, "yoy_pct": 8.0},
            "median_dom": {"value": 40, "yoy_days": 5},
            "price_drops_share_pct": {"value": 19.5, "yoy_pp": 4.5},
            "sale_to_list_pct": {"value": 95.8, "yoy_pp": -0.6},
            "months_of_supply": {"value": 4.8, "yoy": 0.6},
        },
        "temperature": {"label": "Cool", "score": 31, "relative_to": "50 largest metros"},
        "market_type": "Balanced",
        "flags": ["Price cuts at a 36-month high"],
        "rates": {"mortgage30_pct": 6.18, "mortgage30_year_ago_pct": 6.35},
        "affordability": {"payment_now": 2211, "payment_change_pct": -2.5},
    },
    {  # 9. slowing market (dom +10 days)
        "metro": "Portland, OR",
        "data_through": "August 2026",
        "metrics": {
            "median_sale_price": {"value": 555000, "yoy_pct": 0.5},
            "inventory": {"value": 3900, "yoy_pct": 5.5},
            "median_dom": {"value": 44, "yoy_days": 12},
            "price_drops_share_pct": {"value": 11.0, "yoy_pp": 1.5},
            "sale_to_list_pct": {"value": 98.2, "yoy_pp": -0.1},
            "months_of_supply": {"value": 4.0, "yoy": 0.3},
        },
        "temperature": {"label": "Balanced", "score": 47, "relative_to": "50 largest metros"},
        "market_type": "Balanced",
        "flags": ["Days on market +12 YoY"],
        "rates": {"mortgage30_pct": 6.18, "mortgage30_year_ago_pct": 6.35},
        "affordability": {"payment_now": 2822, "payment_change_pct": 0.9},
    },
    {  # 10. rent outpacing home values
        "metro": "Charlotte, NC",
        "data_through": "August 2026",
        "metrics": {
            "median_sale_price": {"value": 400000, "yoy_pct": 1.0},
            "inventory": {"value": 5300, "yoy_pct": 2.0},
            "median_dom": {"value": 33, "yoy_days": 2},
            "price_drops_share_pct": {"value": 9.0, "yoy_pp": 0.5},
            "sale_to_list_pct": {"value": 98.9, "yoy_pp": 0.1},
            "months_of_supply": {"value": 3.6, "yoy": 0.1},
            "zori_rent": {"value": 1850, "yoy_pct": 5.5},
        },
        "temperature": {"label": "Balanced", "score": 55, "relative_to": "50 largest metros"},
        "market_type": "Balanced",
        "flags": ["Rent growth outpacing home values"],
        "rates": {"mortgage30_pct": 6.18, "mortgage30_year_ago_pct": 6.35},
        "affordability": {"payment_now": 2043, "payment_change_pct": 1.3},
    },
    {  # 11. large payment jump from rate move
        "metro": "Denver, CO",
        "data_through": "August 2026",
        "metrics": {
            "median_sale_price": {"value": 620000, "yoy_pct": 3.0},
            "inventory": {"value": 4700, "yoy_pct": -6.0},
            "median_dom": {"value": 25, "yoy_days": -2},
            "price_drops_share_pct": {"value": 9.5, "yoy_pp": -0.5},
            "sale_to_list_pct": {"value": 99.9, "yoy_pp": 0.4},
            "months_of_supply": {"value": 3.1, "yoy": -0.2},
        },
        "temperature": {"label": "Warm", "score": 68, "relative_to": "50 largest metros"},
        "market_type": "Balanced",
        "flags": ["Monthly payment +12% YoY"],
        "rates": {"mortgage30_pct": 7.10, "mortgage30_year_ago_pct": 6.20},
        "affordability": {"payment_now": 3505, "payment_change_pct": 12.4},
    },
    {  # 12. no income / minimal affordability data
        "metro": "Wichita, KS",
        "data_through": "August 2026",
        "metrics": {
            "median_sale_price": {"value": 215000, "yoy_pct": 2.2},
            "inventory": {"value": 1900, "yoy_pct": 1.0},
            "median_dom": {"value": 35, "yoy_days": 1},
            "price_drops_share_pct": {"value": 7.5, "yoy_pp": 0.2},
            "sale_to_list_pct": {"value": 97.9, "yoy_pp": 0.0},
            "months_of_supply": {"value": 3.9, "yoy": 0.0},
        },
        "temperature": {"label": "Balanced", "score": 49, "relative_to": "50 largest metros"},
        "market_type": "Balanced",
        "flags": [],
        "rates": {"mortgage30_pct": 6.18, "mortgage30_year_ago_pct": 6.35},
        "affordability": {"payment_now": 1088, "payment_change_pct": None},
    },
]

NATIONAL_FACTS: list[dict[str, Any]] = [
    {
        "metro": "the United States",
        "data_through": "August 2026",
        "metrics": {
            "median_sale_price": {"value": 431200, "yoy_pct": 2.1},
            "inventory": {"value": 1612000, "yoy_pct": 14.0},
        },
        "rates": {"mortgage30_pct": 6.18},
    },
    {
        "metro": "the United States",
        "data_through": "July 2026",
        "metrics": {
            "median_sale_price": {"value": 425000, "yoy_pct": -1.5},
            "inventory": {"value": 1550000, "yoy_pct": -3.0},
        },
        "rates": {"mortgage30_pct": 6.35},
    },
]

NATIONAL_ALERTS: list[list[dict[str, Any]]] = [
    [
        {"flag": "inventory_surge", "label": "Inventory +25% YoY", "severity": "notable", "slugs": ["a", "b", "c"]},
        {"flag": "price_decline", "label": "Median price -4% YoY", "severity": "notable", "slugs": ["d", "e"]},
    ],
    [
        {"flag": "inventory_drop", "label": "Inventory -22% YoY", "severity": "notable", "slugs": ["f"]},
    ],
]

NATIONAL_MOVER_COUNTS: list[dict[str, int]] = [
    {"have more price cuts than a year ago": 31},
    {"have more price cuts than a year ago": 12},
]
