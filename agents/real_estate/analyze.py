"""Where SPEC_REAL_ESTATE.md §7's LLM brief generation plugs in.

For now every brief comes from `templates.py` (deterministic, no LLM
calls) — this module builds the §7.2 facts dict from computed metrics and
wraps the template's `{"text", "key_points"}` in the `schema.Brief` shape
the LLM/Batch API path will eventually also produce (`narrative_source`
tells them apart). Swapping in the real batch flow later means adding a
branch here, not changing any caller.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from agents.real_estate import templates
from agents.real_estate.schema import Brief, Citation

REDFIN_CITATION = Citation(
    name="Redfin Data Center",
    url="https://www.redfin.com/news/data-center/",
    attribution="Data: Redfin, a national real estate brokerage.",
)
ZILLOW_CITATION = Citation(
    name="Zillow Research",
    url="https://www.zillow.com/research/data/",
    attribution="Zillow Home Value Index (ZHVI) and Zillow Observed Rent Index (ZORI), Zillow Research.",
)
FRED_CITATION = Citation(
    name="FRED, Federal Reserve Bank of St. Louis", url="https://fred.stlouisfed.org/"
)


def to_pct(ratio: float | None) -> float | None:
    """Convert a stored ratio (0.031) into the facts dict's human units (3.1)."""
    return None if ratio is None else round(ratio * 100, 1)


def build_metro_facts(
    *,
    metro_name: str,
    data_through: str,
    median_sale_price: dict[str, Any],
    inventory: dict[str, Any],
    median_dom: dict[str, Any],
    price_drops: dict[str, Any],
    sale_to_list: dict[str, Any],
    months_of_supply_value: float | None,
    months_of_supply_yoy: float | None,
    zori: dict[str, Any] | None,
    temperature_label: str | None,
    temperature_score: int | None,
    market_type: str | None,
    flag_labels: list[str],
    mortgage30_pct: float | None,
    mortgage30_year_ago_pct: float | None,
    payment_now: float | None,
    payment_change_pct: float | None,
) -> dict[str, Any]:
    """Assembles the SPEC §7.2 facts dict: every number pre-formatted into
    human units so a future LLM call never has to convert anything, and
    the guard can compare against exactly these numbers."""
    metrics: dict[str, dict[str, Any]] = {
        "median_sale_price": {
            "value": median_sale_price.get("value"),
            "yoy_pct": to_pct(median_sale_price.get("yoy")),
        },
        "inventory": {"value": inventory.get("value"), "yoy_pct": to_pct(inventory.get("yoy"))},
        "median_dom": {"value": median_dom.get("value"), "yoy_days": median_dom.get("yoy")},
        "price_drops_share_pct": {
            "value": to_pct(price_drops.get("value")),
            "yoy_pp": to_pct(price_drops.get("yoy")),
        },
        "sale_to_list_pct": {
            "value": to_pct(sale_to_list.get("value")),
            "yoy_pp": to_pct(sale_to_list.get("yoy")),
        },
        "months_of_supply": {"value": months_of_supply_value, "yoy": months_of_supply_yoy},
    }
    if zori is not None and zori.get("value") is not None:
        metrics["zori_rent"] = {"value": zori.get("value"), "yoy_pct": to_pct(zori.get("yoy"))}

    return {
        "metro": metro_name,
        "data_through": data_through,
        "metrics": metrics,
        "temperature": {
            "label": temperature_label,
            "score": temperature_score,
            "relative_to": "50 largest metros",
        },
        "market_type": market_type,
        "flags": flag_labels,
        "rates": {"mortgage30_pct": mortgage30_pct, "mortgage30_year_ago_pct": mortgage30_year_ago_pct},
        "affordability": {"payment_now": payment_now, "payment_change_pct": to_pct(payment_change_pct)},
    }


def generate_metro_brief(facts: dict[str, Any], *, reused: bool) -> Brief:
    result = templates.metro_brief(facts)
    citations = [REDFIN_CITATION]
    if "zori_rent" in facts["metrics"]:
        citations.append(ZILLOW_CITATION)
    return Brief(
        text=result["text"],
        key_points=result["key_points"],
        citations=citations,
        narrative_source="template",
        model=None,
        generated_at=datetime.now(UTC),
        reused=reused,
    )


def reuse_brief(prior: dict[str, Any]) -> Brief:
    """Rebuilds a `Brief` from a previously published metro file's `brief`
    block, marking it `reused=True` — no template or LLM call is made."""
    data = dict(prior)
    data["reused"] = True
    return Brief.model_validate(data)


def generate_national_brief(
    facts: dict[str, Any], alerts: list[dict[str, Any]], mover_counts: dict[str, int]
) -> Brief:
    result = templates.national_brief(facts, alerts, mover_counts)
    return Brief(
        text=result["text"],
        key_points=result["key_points"],
        citations=[REDFIN_CITATION, FRED_CITATION],
        narrative_source="template",
        model=None,
        generated_at=datetime.now(UTC),
        reused=False,
    )
