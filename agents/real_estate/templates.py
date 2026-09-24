"""Deterministic headline and brief generation (SPEC_REAL_ESTATE.md §5.6,
§7.6). In this build these are the *only* brief path — no LLM calls are
made anywhere in the pipeline — so every brief's `narrative_source` is
`"template"`. `agents/real_estate/analyze.py` is the seam where the
spec's Batch API path (§7) plugs in later without changing this module's
contract: a facts dict in, `{"text": ..., "key_points": [...]}` out.
"""

from __future__ import annotations

from typing import Any


def metro_brief(facts: dict[str, Any]) -> dict[str, Any]:
    """`facts` follows the SPEC §7.2 contract: every number pre-formatted
    into human units (percents as 3.1, not 0.031)."""
    metro = facts["metro"]
    m = facts["metrics"]
    price = m["median_sale_price"]
    inv = m["inventory"]
    dom = m["median_dom"]
    temp = facts["temperature"]

    price_yoy = price.get("yoy_pct") or 0.0
    inv_yoy = inv.get("yoy_pct") or 0.0
    price_dir = "up" if price_yoy >= 0 else "down"
    inv_dir = "rose" if inv_yoy >= 0 else "fell"

    sentence1 = (
        f"{metro}'s median sale price was ${price['value']:,.0f} in {facts['data_through']}, "
        f"{price_dir} {abs(price_yoy):.1f}% from a year earlier."
    )
    sentence2 = (
        f"Inventory {inv_dir} {abs(inv_yoy):.1f}% YoY, and homes spent a median "
        f"{dom['value']:.0f} days on market."
    )
    sentence3 = f"The market is {temp['label']} relative to the {temp['relative_to']}."

    # Name any other flags price/inventory/temperature don't already cover,
    # so a brief doesn't silently omit a notable shift just because the
    # first three sentences have a fixed shape (SPEC §5.4's flag coverage).
    covered_terms = ("median price", "inventory")
    other_flags = [f for f in facts.get("flags", []) if not any(t in f.lower() for t in covered_terms)]
    sentence4 = f"Other notable signals: {'; '.join(other_flags)}." if other_flags else ""

    key_points = [
        f"Median price {price_yoy:+.1f}% YoY" if price.get("yoy_pct") is not None else None,
        f"Inventory {inv_yoy:+.1f}% YoY" if inv.get("yoy_pct") is not None else None,
        f"{temp['label']} ({temp['score']}/100) vs the 50 largest metros" if temp.get("score") is not None else None,
    ]
    key_points = [k for k in key_points if k][:3]

    text = " ".join(s for s in (sentence1, sentence2, sentence3, sentence4) if s)
    return {"text": text, "key_points": key_points}


def national_brief(
    facts: dict[str, Any], alerts: list[dict[str, Any]], mover_counts: dict[str, int]
) -> dict[str, Any]:
    """`alerts` is the top alerts list (§6.1 `alerts`); `mover_counts` is a
    dict like `{"metros with more price cuts than a year ago": 31}`."""
    m = facts["metrics"]
    price = m["median_sale_price"]
    inv = m["inventory"]

    price_yoy = price.get("yoy_pct") or 0.0
    inv_yoy = inv.get("yoy_pct") or 0.0

    sentence1 = (
        f"The U.S. median sale price was ${price['value']:,.0f} in {facts['data_through']}, "
        f"{'up' if price_yoy >= 0 else 'down'} {abs(price_yoy):.1f}% from a year earlier."
    )
    sentence2 = f"National inventory is {'up' if inv_yoy >= 0 else 'down'} {abs(inv_yoy):.1f}% YoY."

    rates = facts.get("rates", {})
    rate_sentence = (
        f" The 30-year fixed mortgage rate is {rates['mortgage30_pct']:.2f}%."
        if rates.get("mortgage30_pct") is not None
        else ""
    )

    alert_sentence = ""
    if alerts:
        top = alerts[0]
        alert_sentence = f" {top['label']} in {len(top.get('slugs', []))} of 50 tracked metros."

    counts_sentence = ""
    if mover_counts:
        label, value = next(iter(mover_counts.items()))
        counts_sentence = f" {value} of 50 metros {label}."

    text = " ".join(
        part for part in (sentence1, sentence2, rate_sentence.strip(), alert_sentence.strip(), counts_sentence.strip()) if part
    )

    key_points = [
        f"Median price {price_yoy:+.1f}% YoY" if price.get("yoy_pct") is not None else None,
        f"Inventory {inv_yoy:+.1f}% YoY" if inv.get("yoy_pct") is not None else None,
        f"30-yr mortgage rate at {rates['mortgage30_pct']:.2f}%" if rates.get("mortgage30_pct") is not None else None,
    ]
    key_points = [k for k in key_points if k][:3]

    return {"text": text, "key_points": key_points}


def headline(
    *,
    inventory_national_yoy: float | None,
    price_national_yoy: float | None,
    price_drops_count: int | None,
    total_metros: int,
) -> str:
    """Picks between the inventory- and price-led patterns based on which
    national YoY change is larger in absolute terms (§5.6)."""
    inv = inventory_national_yoy or 0.0
    price = price_national_yoy or 0.0
    suffix = (
        f" {price_drops_count} of {total_metros} metros have more price cuts than a year ago."
        if price_drops_count is not None
        else ""
    )
    if abs(inv) >= abs(price):
        return f"Inventory {'up' if inv >= 0 else 'down'} {abs(inv) * 100:.0f}% YoY nationally;{suffix}".strip()
    return (
        f"Median sale prices are {'up' if price >= 0 else 'down'} {abs(price) * 100:.1f}% YoY nationally;{suffix}"
    ).strip()
