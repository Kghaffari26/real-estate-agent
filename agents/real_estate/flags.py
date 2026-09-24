"""Deterministic market-shift flags (SPEC_REAL_ESTATE.md §5.4). Thresholds
come from `config/real_estate.toml`'s `[flags]` table — never hardcode a
threshold here, so the config file stays the one place they're tuned.
"""

from __future__ import annotations

from dataclasses import dataclass, field

Severity = str  # "info" | "notable" | "major"


@dataclass
class Flag:
    id: str
    label: str
    severity: Severity
    facts: dict[str, float] = field(default_factory=dict)


def evaluate_flags(
    *,
    inventory_yoy: float | None,
    median_sale_price_yoy: float | None,
    median_sale_price_high_36m: bool | None,
    median_sale_price_low_36m: bool | None,
    price_drops_yoy: float | None,
    price_drops_high_36m: bool | None,
    median_dom_yoy: float | None,
    months_of_supply_value: float | None,
    months_of_supply_prior: float | None,
    zori_yoy: float | None,
    zhvi_yoy: float | None,
    permits_yoy_12m: float | None,
    payment_change_pct: float | None,
    thresholds: dict[str, float],
) -> list[Flag]:
    flags: list[Flag] = []
    t = thresholds

    if inventory_yoy is not None:
        surge = t.get("inventory_surge_yoy", 0.25)
        surge_major = t.get("inventory_surge_major_yoy", 0.50)
        if inventory_yoy >= surge:
            severity = "major" if inventory_yoy >= surge_major else "notable"
            flags.append(
                Flag("inventory_surge", f"Inventory +{inventory_yoy:.0%} YoY", severity,
                     {"inventory_yoy": inventory_yoy})
            )
        drop = t.get("inventory_drop_yoy", -0.20)
        if inventory_yoy <= drop:
            flags.append(
                Flag("inventory_drop", f"Inventory {inventory_yoy:.0%} YoY", "notable",
                     {"inventory_yoy": inventory_yoy})
            )

    if median_sale_price_yoy is not None:
        decline = t.get("price_decline_yoy", -0.03)
        decline_major = t.get("price_decline_major_yoy", -0.08)
        if median_sale_price_yoy <= decline:
            severity = "major" if median_sale_price_yoy <= decline_major else "notable"
            flags.append(
                Flag("price_decline", f"Median price {median_sale_price_yoy:.1%} YoY", severity,
                     {"median_sale_price_yoy": median_sale_price_yoy})
            )
        surge = t.get("price_surge_yoy", 0.08)
        if median_sale_price_yoy >= surge:
            flags.append(
                Flag("price_surge", f"Median price +{median_sale_price_yoy:.1%} YoY", "notable",
                     {"median_sale_price_yoy": median_sale_price_yoy})
            )

    if median_sale_price_high_36m:
        flags.append(Flag("price_36m_high", "36-month high median sale price", "info"))
    if median_sale_price_low_36m:
        flags.append(Flag("price_36m_low", "36-month low median sale price", "info"))

    if price_drops_high_36m and price_drops_yoy is not None:
        cuts_pp = t.get("price_cuts_yoy_pp", 0.03)
        if price_drops_yoy >= cuts_pp:
            flags.append(
                Flag("price_cuts_high", "Price cuts at a 36-month high", "notable",
                     {"price_drops_yoy_pp": price_drops_yoy})
            )

    if median_dom_yoy is not None:
        slowing_days = t.get("slowing_dom_days", 10)
        if median_dom_yoy >= slowing_days:
            flags.append(
                Flag("slowing", f"Days on market +{median_dom_yoy:.0f} YoY", "info",
                     {"median_dom_yoy_days": median_dom_yoy})
            )

    if months_of_supply_value is not None and months_of_supply_prior is not None:
        if months_of_supply_prior < 6 <= months_of_supply_value:
            flags.append(
                Flag("buyers_market", "Crossed into a buyer's market", "notable",
                     {"months_of_supply": months_of_supply_value})
            )
        if months_of_supply_prior >= 3 > months_of_supply_value:
            flags.append(
                Flag("sellers_market", "Crossed into a seller's market", "notable",
                     {"months_of_supply": months_of_supply_value})
            )

    if zori_yoy is not None and zhvi_yoy is not None:
        outpacing_pp = t.get("rent_outpacing_pp", 3.0) / 100
        if (zori_yoy - zhvi_yoy) >= outpacing_pp:
            flags.append(
                Flag("rent_outpacing", "Rent growth outpacing home values", "info",
                     {"rent_minus_value_yoy_pp": zori_yoy - zhvi_yoy})
            )

    if permits_yoy_12m is not None:
        swing = t.get("permits_swing_12m", 0.30)
        if permits_yoy_12m >= swing:
            flags.append(
                Flag("permits_boom", f"Permits +{permits_yoy_12m:.0%} YoY (12mo)", "info",
                     {"permits_yoy_12m": permits_yoy_12m})
            )
        if permits_yoy_12m <= -swing:
            flags.append(
                Flag("permits_bust", f"Permits {permits_yoy_12m:.0%} YoY (12mo)", "info",
                     {"permits_yoy_12m": permits_yoy_12m})
            )

    if payment_change_pct is not None:
        jump = t.get("payment_jump", 0.10)
        if payment_change_pct >= jump:
            flags.append(
                Flag("payment_jump", f"Monthly payment +{payment_change_pct:.0%} YoY", "notable",
                     {"payment_change_pct": payment_change_pct})
            )

    return flags
