from __future__ import annotations

from datetime import date

import pytest

from agents.real_estate.compute import (
    MetricChange,
    add_percentile_ranks,
    amortized_payment,
    compute_affordability,
    compute_metric_series,
    compute_permits,
    month_end_dates,
    rolling_12m,
    series_for_dates,
    trailing_sum,
    value_at_offset,
)
from tests.conftest import month_series

# -- compute_metric_series: change_kind = "ratio" ------------------------


def test_ratio_change_kind_computes_percent_yoy_and_mom():
    # 13 months of data so month -12 (a year ago) exists.
    values = [100.0 + i for i in range(13)]  # 100..112, latest=112
    series = month_series((2025, 8), values)

    change = compute_metric_series(series, change_kind="ratio", as_of=date(2026, 8, 1))

    assert change.value == 112.0
    assert change.mom == pytest.approx((112 - 111) / 111)
    assert change.yoy == pytest.approx((112 - 100) / 100)


def test_ratio_change_kind_returns_none_when_prior_is_zero():
    series = [(date(2025, 8, 1), 0.0), (date(2026, 8, 1), 50.0)]
    change = compute_metric_series(series, change_kind="ratio", as_of=date(2026, 8, 1))
    assert change.yoy is None


# -- compute_metric_series: change_kind = "pp" (already a 0-1 share) -----


def test_pp_change_kind_is_a_plain_difference():
    series = [
        (date(2025, 8, 1), 0.30),
        (date(2026, 7, 1), 0.33),
        (date(2026, 8, 1), 0.35),
    ]
    change = compute_metric_series(series, change_kind="pp", as_of=date(2026, 8, 1))
    assert change.mom == pytest.approx(0.02)
    assert change.yoy == pytest.approx(0.05)


# -- compute_metric_series: change_kind = "diff" (native units) ----------


def test_diff_change_kind_is_a_plain_difference():
    series = [
        (date(2025, 8, 1), 25.0),
        (date(2026, 7, 1), 30.0),
        (date(2026, 8, 1), 28.0),
    ]
    change = compute_metric_series(series, change_kind="diff", as_of=date(2026, 8, 1))
    assert change.mom == pytest.approx(-2.0)
    assert change.yoy == pytest.approx(3.0)


# -- 36-month highs and lows ----------------------------------------------


def test_high_36m_true_when_latest_is_the_max_of_the_window():
    values = list(range(1, 37))  # 1..36, latest (37th month) is the max
    series = month_series((2023, 9), values)
    change = compute_metric_series(series, change_kind="ratio", as_of=date(2026, 8, 1), history_months=36)
    assert change.high_36m is True
    assert change.low_36m is False


def test_low_36m_true_when_latest_is_the_min_of_the_window():
    values = list(range(36, 0, -1))  # descending, latest is the min
    series = month_series((2023, 9), values)
    change = compute_metric_series(series, change_kind="ratio", as_of=date(2026, 8, 1), history_months=36)
    assert change.low_36m is True
    assert change.high_36m is False


def test_high_and_low_36m_both_true_for_a_single_data_point():
    series = [(date(2026, 8, 1), 100.0)]
    change = compute_metric_series(series, change_kind="ratio", as_of=date(2026, 8, 1))
    assert change.high_36m is True
    assert change.low_36m is True


def test_high_36m_only_considers_the_trailing_history_window():
    # A huge value far outside the 36-month window must not count.
    outlier = (date(2015, 1, 1), 999999.0)
    values = list(range(1, 37))
    series = [outlier, *month_series((2023, 9), values)]
    change = compute_metric_series(series, change_kind="ratio", as_of=date(2026, 8, 1), history_months=36)
    assert change.high_36m is True  # latest (36) is still the window's max


def test_compute_metric_series_returns_none_value_when_latest_month_missing():
    series = month_series((2025, 1), [1.0] * 6)
    change = compute_metric_series(series, change_kind="ratio", as_of=date(2026, 8, 1))
    assert change == MetricChange(value=None)


def test_compute_metric_series_empty_series():
    change = compute_metric_series([], change_kind="ratio")
    assert change == MetricChange(value=None)


def test_compute_metric_series_defaults_as_of_to_latest_available_month():
    series = month_series((2026, 1), [10.0, 20.0, 30.0])
    change = compute_metric_series(series, change_kind="ratio")
    assert change.value == 30.0


# -- trend_3m --------------------------------------------------------------


def test_trend_3m_up_when_relative_change_exceeds_half_percent():
    series = month_series((2026, 6), [100.0, 100.3, 101.0])
    change = compute_metric_series(series, change_kind="ratio", as_of=date(2026, 8, 1))
    assert change.trend_3m == "up"


def test_trend_3m_flat_when_relative_change_under_half_percent():
    series = month_series((2026, 6), [100.0, 100.1, 100.2])
    change = compute_metric_series(series, change_kind="ratio", as_of=date(2026, 8, 1))
    assert change.trend_3m == "flat"


def test_trend_3m_down():
    series = month_series((2026, 6), [100.0, 98.0, 95.0])
    change = compute_metric_series(series, change_kind="ratio", as_of=date(2026, 8, 1))
    assert change.trend_3m == "down"


# -- percentile ranks -------------------------------------------------------


def test_add_percentile_ranks_orders_slugs_by_value():
    changes = {
        "a": MetricChange(value=10.0, yoy=0.01),
        "b": MetricChange(value=30.0, yoy=0.05),
        "c": MetricChange(value=20.0, yoy=0.03),
    }
    add_percentile_ranks(changes)
    assert changes["a"].pct_rank == 0.0
    assert changes["c"].pct_rank == 0.5
    assert changes["b"].pct_rank == 1.0
    assert changes["a"].yoy_pct_rank == 0.0
    assert changes["c"].yoy_pct_rank == 0.5
    assert changes["b"].yoy_pct_rank == 1.0


def test_add_percentile_ranks_skips_null_values():
    changes = {
        "a": MetricChange(value=None, yoy=None),
        "b": MetricChange(value=10.0, yoy=0.01),
    }
    add_percentile_ranks(changes)
    assert changes["a"].pct_rank is None
    assert changes["b"].pct_rank is None  # only one non-null value: no ranking


def test_add_percentile_ranks_noop_with_fewer_than_two_values():
    changes = {"a": MetricChange(value=10.0)}
    add_percentile_ranks(changes)
    assert changes["a"].pct_rank is None


# -- value_at_offset ---------------------------------------------------------


def test_value_at_offset_returns_prior_raw_value():
    series = month_series((2026, 1), [10.0, 20.0, 30.0])
    assert value_at_offset(series, offset=1, as_of=date(2026, 3, 1)) == 20.0
    assert value_at_offset(series, offset=2, as_of=date(2026, 3, 1)) == 10.0


def test_value_at_offset_returns_none_when_missing():
    series = month_series((2026, 1), [10.0])
    assert value_at_offset(series, offset=5, as_of=date(2026, 1, 1)) is None


def test_value_at_offset_empty_series_returns_none():
    assert value_at_offset([], offset=0) is None


# -- series_for_dates --------------------------------------------------------


def test_series_for_dates_aligns_to_shared_dates_array():
    series = [(date(2026, 1, 1), 1.0), (date(2026, 3, 1), 3.0)]
    dates = [date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1)]
    assert series_for_dates(series, dates) == [1.0, None, 3.0]


# -- trailing_sum -------------------------------------------------------------


def test_trailing_sum_sums_whatever_months_are_present():
    series = month_series((2026, 1), [1.0, 2.0, None, 4.0])
    total = trailing_sum(series, months=12, as_of=date(2026, 4, 1))
    assert total == pytest.approx(7.0)  # None excluded, not required


def test_trailing_sum_returns_none_for_empty_series():
    assert trailing_sum([], months=12) is None


def test_trailing_sum_respects_months_window():
    series = month_series((2025, 1), [10.0] * 15)
    total = trailing_sum(series, months=3, as_of=date(2026, 3, 1))
    assert total == pytest.approx(30.0)


# -- month_end_dates ----------------------------------------------------------


def test_month_end_dates_returns_consecutive_month_ends_oldest_first():
    dates = month_end_dates(date(2026, 3, 15), months=3)
    assert dates == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31)]


def test_month_end_dates_handles_december_anchor():
    dates = month_end_dates(date(2026, 12, 5), months=2)
    assert dates == [date(2026, 11, 30), date(2026, 12, 31)]


def test_month_end_dates_handles_year_rollover_in_window():
    dates = month_end_dates(date(2026, 1, 20), months=2)
    assert dates == [date(2025, 12, 31), date(2026, 1, 31)]


# -- rolling_12m / compute_permits ---------------------------------------------


def test_rolling_12m_requires_all_12_trailing_months_present():
    values = [10.0] * 12  # exactly 12 months
    series = month_series((2025, 1), values)
    rolled = rolling_12m(series)
    # only the 12th month (index 11) has a full trailing window
    assert len(rolled) == 1
    latest_key = max(rolled)
    assert rolled[latest_key] == pytest.approx(120.0)


def test_rolling_12m_skips_months_with_a_gap():
    values = [10.0] * 6 + [None] + [10.0] * 6
    series = month_series((2025, 1), values)
    rolled = rolling_12m(series)
    # the gap means several months never get a complete window
    for total in rolled.values():
        assert total == pytest.approx(120.0)


def test_compute_permits_yoy_12m():
    # 24 months of steady 100/month permits, then a step up to 110/month
    # for the final 12 so this year's rolling-12m sum is 10% above last
    # year's.
    values = [100.0] * 12 + [110.0] * 12
    series = month_series((2024, 9), values)
    as_of = series[-1][0]
    result = compute_permits(series, as_of=as_of)
    assert result["value"] == pytest.approx(1320.0)
    assert result["yoy_12m"] == pytest.approx(0.10)


def test_compute_permits_returns_none_when_no_full_window_exists():
    series = month_series((2026, 1), [100.0] * 3)
    result = compute_permits(series)
    assert result == {"value": None, "yoy_12m": None}


def test_compute_permits_yoy_12m_none_without_a_prior_year_window():
    values = [100.0] * 12
    series = month_series((2025, 1), values)
    result = compute_permits(series, as_of=series[-1][0])
    assert result["value"] == pytest.approx(1200.0)
    assert result["yoy_12m"] is None


# -- amortized_payment / affordability ----------------------------------------


def test_amortized_payment_matches_known_test_vector():
    # $400,000 principal at 6.5% annual over 30 years -> $2,528.27/mo.
    payment = amortized_payment(400000, 6.5, 30)
    assert payment == pytest.approx(2528.27, abs=0.01)


def test_amortized_payment_zero_rate_is_a_plain_division():
    payment = amortized_payment(360000, 0.0, 30)
    assert payment == pytest.approx(360000 / 360)


def test_compute_affordability_full_year_over_year_inputs():
    result = compute_affordability(
        price_now=400000,
        price_year_ago=380000,
        rate_now=6.5,
        rate_year_ago=7.0,
        median_household_income=90000,
        income_year=2024,
    )
    expected_payment_now = amortized_payment(400000 * 0.80, 6.5, 30)
    expected_payment_year_ago = amortized_payment(380000 * 0.80, 7.0, 30)
    assert result.payment_now == pytest.approx(round(expected_payment_now, 2))
    assert result.payment_year_ago == pytest.approx(round(expected_payment_year_ago, 2))
    # payment_change_pct is computed from the unrounded payments, not the
    # rounded-to-the-cent fields above.
    assert result.payment_change_pct == pytest.approx(
        expected_payment_now / expected_payment_year_ago - 1
    )
    assert result.payment_to_income == pytest.approx(expected_payment_now * 12 / 90000)
    assert result.median_household_income == 90000
    assert result.income_year == 2024
    assert result.assumptions["down_payment_pct"] == 0.20
    assert result.assumptions["term_years"] == 30


def test_compute_affordability_missing_year_ago_inputs():
    result = compute_affordability(
        price_now=400000,
        price_year_ago=None,
        rate_now=6.5,
        rate_year_ago=None,
    )
    assert result.payment_year_ago is None
    assert result.payment_change_pct is None
    assert result.payment_to_income is None


def test_compute_affordability_respects_custom_down_payment_and_term():
    result = compute_affordability(
        price_now=300000,
        price_year_ago=None,
        rate_now=6.0,
        rate_year_ago=None,
        down_payment_pct=0.10,
        term_years=15,
    )
    expected = round(amortized_payment(300000 * 0.90, 6.0, 15), 2)
    assert result.payment_now == expected
    assert result.assumptions["term_years"] == 15
    assert result.assumptions["down_payment_pct"] == 0.10
