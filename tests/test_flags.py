from __future__ import annotations

from agents.real_estate.flags import evaluate_flags

EPS = 1e-6

THRESHOLDS = {
    "inventory_surge_yoy": 0.25,
    "inventory_surge_major_yoy": 0.50,
    "inventory_drop_yoy": -0.20,
    "price_decline_yoy": -0.03,
    "price_decline_major_yoy": -0.08,
    "price_surge_yoy": 0.08,
    "price_cuts_yoy_pp": 0.03,
    "slowing_dom_days": 10,
    "rent_outpacing_pp": 3.0,
    "permits_swing_12m": 0.30,
    "payment_jump": 0.10,
}

DEFAULT_KWARGS = dict(
    inventory_yoy=None,
    median_sale_price_yoy=None,
    median_sale_price_high_36m=None,
    median_sale_price_low_36m=None,
    price_drops_yoy=None,
    price_drops_high_36m=None,
    median_dom_yoy=None,
    months_of_supply_value=None,
    months_of_supply_prior=None,
    zori_yoy=None,
    zhvi_yoy=None,
    permits_yoy_12m=None,
    payment_change_pct=None,
    thresholds=THRESHOLDS,
)


def _flags(**overrides):
    kwargs = {**DEFAULT_KWARGS, **overrides}
    return evaluate_flags(**kwargs)


def _ids(flags):
    return [f.id for f in flags]


# -- inventory_surge / inventory_surge major severity ------------------------


def test_inventory_surge_does_not_fire_just_below_threshold():
    assert "inventory_surge" not in _ids(_flags(inventory_yoy=0.25 - EPS))


def test_inventory_surge_fires_at_threshold_as_notable():
    flags = _flags(inventory_yoy=0.25)
    surge = next(f for f in flags if f.id == "inventory_surge")
    assert surge.severity == "notable"


def test_inventory_surge_upgrades_to_major_at_major_threshold():
    flags = _flags(inventory_yoy=0.50)
    surge = next(f for f in flags if f.id == "inventory_surge")
    assert surge.severity == "major"


def test_inventory_surge_stays_notable_just_below_major_threshold():
    flags = _flags(inventory_yoy=0.50 - EPS)
    surge = next(f for f in flags if f.id == "inventory_surge")
    assert surge.severity == "notable"


# -- inventory_drop ------------------------------------------------------------


def test_inventory_drop_does_not_fire_just_above_threshold():
    assert "inventory_drop" not in _ids(_flags(inventory_yoy=-0.20 + EPS))


def test_inventory_drop_fires_at_threshold():
    assert "inventory_drop" in _ids(_flags(inventory_yoy=-0.20))


def test_inventory_drop_fires_below_threshold():
    assert "inventory_drop" in _ids(_flags(inventory_yoy=-0.20 - EPS))


# -- price_decline / price_decline major severity ------------------------------


def test_price_decline_does_not_fire_just_above_threshold():
    assert "price_decline" not in _ids(_flags(median_sale_price_yoy=-0.03 + EPS))


def test_price_decline_fires_at_threshold_as_notable():
    flags = _flags(median_sale_price_yoy=-0.03)
    decline = next(f for f in flags if f.id == "price_decline")
    assert decline.severity == "notable"


def test_price_decline_upgrades_to_major_at_major_threshold():
    flags = _flags(median_sale_price_yoy=-0.08)
    decline = next(f for f in flags if f.id == "price_decline")
    assert decline.severity == "major"


def test_price_decline_stays_notable_just_above_major_threshold():
    flags = _flags(median_sale_price_yoy=-0.08 + EPS)
    decline = next(f for f in flags if f.id == "price_decline")
    assert decline.severity == "notable"


# -- price_surge ----------------------------------------------------------------


def test_price_surge_does_not_fire_just_below_threshold():
    assert "price_surge" not in _ids(_flags(median_sale_price_yoy=0.08 - EPS))


def test_price_surge_fires_at_threshold():
    assert "price_surge" in _ids(_flags(median_sale_price_yoy=0.08))


def test_price_surge_fires_above_threshold():
    assert "price_surge" in _ids(_flags(median_sale_price_yoy=0.08 + EPS))


# -- price_36m_high / price_36m_low: pure booleans -----------------------------


def test_price_36m_high_fires_only_when_true():
    assert "price_36m_high" in _ids(_flags(median_sale_price_high_36m=True))
    assert "price_36m_high" not in _ids(_flags(median_sale_price_high_36m=False))
    assert "price_36m_high" not in _ids(_flags(median_sale_price_high_36m=None))


def test_price_36m_low_fires_only_when_true():
    assert "price_36m_low" in _ids(_flags(median_sale_price_low_36m=True))
    assert "price_36m_low" not in _ids(_flags(median_sale_price_low_36m=False))


# -- price_cuts_high: requires BOTH a 36m high in price_drops AND yoy >= pp ----


def test_price_cuts_high_requires_the_36m_high_flag_too():
    flags = _flags(price_drops_high_36m=False, price_drops_yoy=0.10)
    assert "price_cuts_high" not in _ids(flags)


def test_price_cuts_high_does_not_fire_just_below_threshold():
    flags = _flags(price_drops_high_36m=True, price_drops_yoy=0.03 - EPS)
    assert "price_cuts_high" not in _ids(flags)


def test_price_cuts_high_fires_at_threshold():
    flags = _flags(price_drops_high_36m=True, price_drops_yoy=0.03)
    assert "price_cuts_high" in _ids(flags)


def test_price_cuts_high_fires_above_threshold():
    flags = _flags(price_drops_high_36m=True, price_drops_yoy=0.03 + EPS)
    assert "price_cuts_high" in _ids(flags)


# -- slowing (median days on market) -------------------------------------------


def test_slowing_does_not_fire_just_below_threshold():
    assert "slowing" not in _ids(_flags(median_dom_yoy=10 - EPS))


def test_slowing_fires_at_threshold():
    assert "slowing" in _ids(_flags(median_dom_yoy=10))


def test_slowing_fires_above_threshold():
    assert "slowing" in _ids(_flags(median_dom_yoy=10 + EPS))


# -- buyers_market / sellers_market: crossing a months-of-supply boundary -----


def test_buyers_market_does_not_fire_when_value_just_below_six():
    flags = _flags(months_of_supply_prior=5.0, months_of_supply_value=6.0 - EPS)
    assert "buyers_market" not in _ids(flags)


def test_buyers_market_fires_when_value_reaches_six_from_below():
    flags = _flags(months_of_supply_prior=5.9, months_of_supply_value=6.0)
    assert "buyers_market" in _ids(flags)


def test_buyers_market_does_not_fire_when_already_above_six_last_time():
    flags = _flags(months_of_supply_prior=6.0, months_of_supply_value=6.5)
    assert "buyers_market" not in _ids(flags)


def test_sellers_market_does_not_fire_when_value_at_three():
    flags = _flags(months_of_supply_prior=3.5, months_of_supply_value=3.0)
    assert "sellers_market" not in _ids(flags)


def test_sellers_market_fires_when_value_drops_just_below_three():
    flags = _flags(months_of_supply_prior=3.0, months_of_supply_value=3.0 - EPS)
    assert "sellers_market" in _ids(flags)


def test_sellers_market_does_not_fire_when_prior_already_below_three():
    flags = _flags(months_of_supply_prior=2.9, months_of_supply_value=2.5)
    assert "sellers_market" not in _ids(flags)


# -- rent_outpacing ---------------------------------------------------------------


def test_rent_outpacing_does_not_fire_just_below_threshold():
    flags = _flags(zori_yoy=0.10, zhvi_yoy=0.10 - (0.03 - EPS))
    assert "rent_outpacing" not in _ids(flags)


def test_rent_outpacing_fires_at_threshold():
    flags = _flags(zori_yoy=0.10, zhvi_yoy=0.10 - 0.03)
    assert "rent_outpacing" in _ids(flags)


def test_rent_outpacing_fires_above_threshold():
    flags = _flags(zori_yoy=0.10, zhvi_yoy=0.10 - (0.03 + EPS))
    assert "rent_outpacing" in _ids(flags)


# -- permits_boom / permits_bust --------------------------------------------------


def test_permits_boom_does_not_fire_just_below_threshold():
    assert "permits_boom" not in _ids(_flags(permits_yoy_12m=0.30 - EPS))


def test_permits_boom_fires_at_threshold():
    assert "permits_boom" in _ids(_flags(permits_yoy_12m=0.30))


def test_permits_bust_does_not_fire_just_above_negative_threshold():
    assert "permits_bust" not in _ids(_flags(permits_yoy_12m=-0.30 + EPS))


def test_permits_bust_fires_at_negative_threshold():
    assert "permits_bust" in _ids(_flags(permits_yoy_12m=-0.30))


# -- payment_jump -----------------------------------------------------------------


def test_payment_jump_does_not_fire_just_below_threshold():
    assert "payment_jump" not in _ids(_flags(payment_change_pct=0.10 - EPS))


def test_payment_jump_fires_at_threshold():
    assert "payment_jump" in _ids(_flags(payment_change_pct=0.10))


def test_payment_jump_fires_above_threshold():
    assert "payment_jump" in _ids(_flags(payment_change_pct=0.10 + EPS))


# -- misc -------------------------------------------------------------------------


def test_no_flags_when_all_inputs_are_none():
    assert _flags() == []


def test_evaluate_flags_works_with_real_config_thresholds():
    from agents.real_estate.config import load_settings

    settings = load_settings()
    kwargs = {**DEFAULT_KWARGS, "thresholds": settings.flags, "inventory_yoy": 0.30}
    flags = evaluate_flags(**kwargs)
    assert "inventory_surge" in _ids(flags)


def test_flag_facts_carry_the_triggering_value():
    flags = _flags(inventory_yoy=0.30)
    surge = next(f for f in flags if f.id == "inventory_surge")
    assert surge.facts == {"inventory_yoy": 0.30}
