from __future__ import annotations

import pytest

from agents.real_estate.temperature import (
    COMPONENTS,
    Temperature,
    compute_temperature_own_history,
    compute_temperatures,
    label_for_score,
    market_type,
)

DEFAULT_BANDS = (80, 60, 40, 20)


# -- label_for_score / band edges -------------------------------------------


@pytest.mark.parametrize(
    "score,expected_label",
    [
        (100, "Hot"),
        (80, "Hot"),
        (79, "Warm"),
        (60, "Warm"),
        (59, "Balanced"),
        (40, "Balanced"),
        (39, "Cool"),
        (20, "Cool"),
        (19, "Cold"),
        (0, "Cold"),
    ],
)
def test_label_for_score_band_edges(score, expected_label):
    assert label_for_score(score, DEFAULT_BANDS) == expected_label


def test_label_for_score_respects_custom_bands():
    bands = (90, 70, 50, 30)
    assert label_for_score(90, bands) == "Hot"
    assert label_for_score(89, bands) == "Warm"
    assert label_for_score(70, bands) == "Warm"
    assert label_for_score(69, bands) == "Balanced"
    assert label_for_score(30, bands) == "Cool"
    assert label_for_score(29, bands) == "Cold"


# -- market_type --------------------------------------------------------------


@pytest.mark.parametrize(
    "months_of_supply,expected",
    [
        (0.0, "Seller's market"),
        (2.9, "Seller's market"),
        (3.0, "Balanced"),
        (4.5, "Balanced"),
        (6.0, "Balanced"),
        (6.1, "Buyer's market"),
        (10.0, "Buyer's market"),
    ],
)
def test_market_type_boundaries(months_of_supply, expected):
    assert market_type(months_of_supply) == expected


def test_market_type_none_when_supply_unknown():
    assert market_type(None) is None


# -- z-scores / compute_temperatures ------------------------------------------


def test_components_has_six_entries_with_expected_signs():
    assert len(COMPONENTS) == 6
    assert COMPONENTS["avg_sale_to_list"] == 1
    assert COMPONENTS["sold_above_list"] == 1
    assert COMPONENTS["off_market_in_two_weeks"] == 1
    assert COMPONENTS["median_dom"] == -1
    assert COMPONENTS["price_drops"] == -1
    assert COMPONENTS["months_of_supply"] == -1


def _full_component_values(**overrides) -> dict[str, float]:
    base = {
        "avg_sale_to_list": 1.0,
        "sold_above_list": 0.4,
        "off_market_in_two_weeks": 0.3,
        "median_dom": 20.0,
        "price_drops": 0.10,
        "months_of_supply": 3.0,
    }
    base.update(overrides)
    return base


def test_compute_temperatures_scores_a_hotter_metro_higher():
    values_by_slug = {
        "hot-metro": _full_component_values(
            avg_sale_to_list=1.05, sold_above_list=0.6, off_market_in_two_weeks=0.5,
            median_dom=10.0, price_drops=0.05, months_of_supply=1.5,
        ),
        "cold-metro": _full_component_values(
            avg_sale_to_list=0.95, sold_above_list=0.1, off_market_in_two_weeks=0.05,
            median_dom=60.0, price_drops=0.30, months_of_supply=8.0,
        ),
        "mid-metro": _full_component_values(),
    }
    temps = compute_temperatures(values_by_slug, min_components=4)
    assert temps["hot-metro"].score > temps["mid-metro"].score > temps["cold-metro"].score
    assert temps["hot-metro"].label in ("Hot", "Warm")
    assert temps["cold-metro"].label in ("Cool", "Cold")


def test_compute_temperatures_signed_components_all_point_hotter_positive():
    # months_of_supply has sign -1: a metro with LOWER supply than peers
    # should get a POSITIVE signed component (hotter).
    values_by_slug = {
        "low-supply": _full_component_values(months_of_supply=1.0),
        "high-supply": _full_component_values(months_of_supply=9.0),
    }
    temps = compute_temperatures(values_by_slug, min_components=1)
    assert temps["low-supply"].components["months_of_supply"] > 0
    assert temps["high-supply"].components["months_of_supply"] < 0


def test_compute_temperatures_requires_min_components():
    # Only 2 of 6 components present -> below a min_components=4 threshold.
    values_by_slug = {
        "a": {"avg_sale_to_list": 1.0, "sold_above_list": 0.5},
        "b": {"avg_sale_to_list": 0.9, "sold_above_list": 0.3},
    }
    temps = compute_temperatures(values_by_slug, min_components=4)
    assert temps["a"].score is None
    assert temps["a"].label is None


def test_compute_temperatures_null_component_excluded_per_metro():
    values_by_slug = {
        "a": _full_component_values(),
        "b": {**_full_component_values(), "median_dom": None},
    }
    temps = compute_temperatures(values_by_slug, min_components=4)
    # "b" is missing one component but still has 5 -> above min_components=4
    assert "median_dom" not in temps["b"].components
    assert temps["b"].score is not None


def test_compute_temperatures_identical_values_yield_zero_zscore_and_50_score():
    values_by_slug = {
        "a": _full_component_values(),
        "b": _full_component_values(),
    }
    temps = compute_temperatures(values_by_slug, min_components=4)
    assert temps["a"].score == 50
    assert temps["b"].score == 50
    for v in temps["a"].components.values():
        assert v == 0.0


def test_compute_temperature_own_history_uses_own_trailing_history():
    history = {
        "avg_sale_to_list": [0.95, 0.96, 0.97, 0.98, 0.99],
        "sold_above_list": [0.2, 0.25, 0.3, 0.35, 0.4],
        "off_market_in_two_weeks": [0.1, 0.15, 0.2, 0.25, 0.3],
        "median_dom": [40, 35, 30, 25, 20],
        "price_drops": [0.20, 0.18, 0.16, 0.14, 0.12],
        "months_of_supply": [6.0, 5.0, 4.0, 3.0, 2.0],
    }
    latest_values = {
        "avg_sale_to_list": 1.02,
        "sold_above_list": 0.5,
        "off_market_in_two_weeks": 0.4,
        "median_dom": 15,
        "price_drops": 0.08,
        "months_of_supply": 1.0,
    }
    temp = compute_temperature_own_history(latest_values, history, min_components=4)
    assert temp.score is not None
    assert temp.score > 50  # latest values are hotter than the trailing history
    assert isinstance(temp, Temperature)


def test_compute_temperature_own_history_respects_min_components():
    history = {"avg_sale_to_list": [0.95, 0.96, 0.97]}
    latest_values = {"avg_sale_to_list": 1.0}
    temp = compute_temperature_own_history(latest_values, history, min_components=4)
    assert temp.score is None
    assert temp.label is None


def test_compute_temperature_own_history_requires_at_least_two_history_points():
    history = {"avg_sale_to_list": [0.95]}
    latest_values = {"avg_sale_to_list": 1.0}
    temp = compute_temperature_own_history(latest_values, history, min_components=1)
    assert temp.score is None
