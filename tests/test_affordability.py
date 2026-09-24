from __future__ import annotations

import pytest

from agents.real_estate.compute import amortized_payment, compute_affordability

# Shared test vectors (SPEC_REAL_ESTATE.md §11): a $400,000 loan at 6.5%
# annual interest over 30 years amortizes to $2,528.27/month.
KNOWN_VECTORS = [
    # (principal, annual_rate_pct, term_years, expected_monthly_payment)
    (400000, 6.5, 30, 2528.27),
    (300000, 7.0, 30, 1995.91),
    (200000, 5.0, 15, 1581.59),
]


@pytest.mark.parametrize("principal,rate,term,expected", KNOWN_VECTORS)
def test_amortized_payment_known_vectors(principal, rate, term, expected):
    assert amortized_payment(principal, rate, term) == pytest.approx(expected, abs=0.01)


def test_amortized_payment_400k_at_6_5_over_30_years_is_the_canonical_vector():
    # The exact vector called out in the spec.
    assert amortized_payment(400000, 6.5, 30) == pytest.approx(2528.27, abs=0.01)


def test_compute_affordability_applies_down_payment_before_amortizing():
    # $400,000 at 20% down -> $320,000 financed, matching the canonical
    # vector's *financed* amount, not the sale price.
    result = compute_affordability(
        price_now=500000,
        price_year_ago=None,
        rate_now=6.5,
        rate_year_ago=None,
        down_payment_pct=0.20,
    )
    assert result.payment_now == pytest.approx(2528.27, abs=0.01)


def test_compute_affordability_zero_down_payment():
    result = compute_affordability(
        price_now=400000,
        price_year_ago=None,
        rate_now=6.5,
        rate_year_ago=None,
        down_payment_pct=0.0,
    )
    assert result.payment_now == pytest.approx(amortized_payment(400000, 6.5, 30), abs=0.01)


def test_compute_affordability_payment_to_income_ratio():
    result = compute_affordability(
        price_now=400000,
        price_year_ago=None,
        rate_now=6.5,
        rate_year_ago=None,
        median_household_income=60000,
    )
    # payment_to_income is annualized payment / income.
    assert result.payment_to_income == pytest.approx(result.payment_now * 12 / 60000, abs=1e-6)


def test_compute_affordability_no_income_leaves_ratio_null():
    result = compute_affordability(
        price_now=400000, price_year_ago=None, rate_now=6.5, rate_year_ago=None
    )
    assert result.payment_to_income is None
    assert result.median_household_income is None


def test_compute_affordability_records_assumptions_used():
    result = compute_affordability(
        price_now=400000,
        price_year_ago=380000,
        rate_now=6.5,
        rate_year_ago=7.0,
        down_payment_pct=0.20,
        term_years=30,
    )
    assert result.assumptions == {
        "down_payment_pct": 0.20,
        "term_years": 30,
        "rate_now": 6.5,
        "rate_year_ago": 7.0,
        "price_year_ago": 380000,
    }
