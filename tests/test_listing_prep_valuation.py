"""Listing Prep P3 valuation: the pre-feed ZIP $/sq ft range, the comp engine on a
synthetic market with a known pricing rule, confidence rules, and the backtest."""

from __future__ import annotations

import math
import random
from datetime import date

import pytest

from agents.listing_prep import valuation as v

TODAY = date(2026, 9, 30)


def test_condition_score_weights_repairs_and_ignores_nothing_else():
    assert v.condition_score([]) is None
    assert v.condition_score([(4, "cosmetic"), (2, "major_repair")]) == pytest.approx((4 * 1 + 2 * 2.5) / 3.5)
    assert v.condition_adjustment(None) == 1.0
    assert v.condition_adjustment(5) == pytest.approx(1.06) and v.condition_adjustment(1) == pytest.approx(0.94)
    assert v.condition_adjustment(-10) == 0.92


def test_prefeed_value_is_ppsf_times_sqft_with_size_and_condition_and_a_wide_low_range():
    # ZIP: $650/sq ft, median $1.3M → typical 2,000 sq ft. This home: 2,000 sq ft, average condition.
    out = v.zip_ppsf_value(sqft=2000, zip_ppsf=650, zip_median_price=1_300_000, zip_low_sample=False)
    assert out is not None
    assert (out.low, out.high, out.confidence, out.method, out.interval) == (1_105_000, 1_495_000, "low", "zip_ppsf", "rough")
    assert out.mid is None and out.coverage_target is None  # no midpoint and no claimed coverage until comps exist
    assert v.center(out) == pytest.approx(math.sqrt(1_105_000 * 1_495_000))
    assert out.inputs["typical_sqft"] == 2000 and out.inputs["size_adjustment"] == 1.0
    assert any("not a calibrated interval" in n for n in out.notes) and any("condition isn’t reflected" in n for n in out.notes)
    # Bigger home: $/sq ft falls (elasticity -0.3); worn condition (2/5): -3%.
    big = v.zip_ppsf_value(sqft=3000, zip_ppsf=650, zip_median_price=1_300_000, zip_low_sample=False, condition=2.0)
    assert big is not None
    expected = 650 * 3000 * (1.5**-0.3) * 0.97
    assert (big.low, big.high) == (round(expected * 0.85 / 5000) * 5000, round(expected * 1.15 / 5000) * 5000)
    assert big.inputs["condition_adjustment"] == 0.97


def test_prefeed_falls_back_to_the_city_and_widens_when_evidence_is_thin():
    thin = v.zip_ppsf_value(sqft=1500, zip_ppsf=900, zip_median_price=1_200_000, zip_low_sample=True, city_ppsf=700)
    assert thin is not None and thin.inputs["ppsf_source"] == "city" and thin.inputs["spread"] == 0.25
    assert any("city’s $/sq ft" in n for n in thin.notes)
    # A ZIP far from its city adds spread (half the gap, capped at 10 points).
    apart = v.zip_ppsf_value(sqft=1500, zip_ppsf=900, zip_median_price=1_350_000, zip_low_sample=False, city_ppsf=700)
    assert apart is not None and apart.inputs["spread"] == pytest.approx(0.15 + 0.10)
    assert v.zip_ppsf_value(sqft=1500, zip_ppsf=None, zip_median_price=None, zip_low_sample=False) is None


# ---- a synthetic market with a known rule -------------------------------------------

ORIGIN = (33.68, -117.83)


def true_price(h: v.Home, closed: date) -> float:
    months_ago = (TODAY.year - closed.year) * 12 + TODAY.month - closed.month
    trend = 1.004 ** (-months_ago)  # +0.4% a month
    return 900_000 * (h.sqft / 1800) ** 0.7 * (1 + 0.025 * (h.baths - 2)) * (1 + 0.01 * (h.beds - 3)) * (1 - 0.002 * (TODAY.year - h.year_built - 40)) * (1.03 if h.pool else 1) * trend


def index(d: date) -> float:
    return 1.004 ** ((d.year - 2020) * 12 + d.month)


def market(n: int, seed: int, noise: float = 0.0) -> list[v.Sale]:
    rng = random.Random(seed)
    out = []
    for i in range(n):
        h = v.Home(
            sqft=rng.randint(1400, 2400),
            beds=rng.choice([3, 3, 4]),
            baths=rng.choice([2, 2.5, 3]),
            year_built=rng.randint(1970, 1995),
            property_type="single_family",
            lat=ORIGIN[0] + rng.uniform(-0.01, 0.01),
            lon=ORIGIN[1] + rng.uniform(-0.01, 0.01),
            pool=rng.random() < 0.2,
        )
        closed = date(2025 + (i % 2), rng.randint(1, 9) if i % 2 else rng.randint(10, 12), 15)
        out.append(v.Sale(h, true_price(h, closed) * (1 + rng.gauss(0, noise)), closed, id=f"s{i}"))
    return out


SUBJECT = v.Home(sqft=1850, beds=3, baths=2.5, year_built=1980, property_type="single_family", lat=ORIGIN[0], lon=ORIGIN[1])


def test_comp_selection_filters_type_size_age_of_sale_and_distance():
    sales = market(30, 1)
    far = v.Sale(v.Home(1850, 3, 2.5, 1980, "single_family", 34.2, -118.4), 1e6, date(2026, 6, 1))
    condo = v.Sale(v.Home(1850, 3, 2.5, 1980, "condo", *ORIGIN), 1e6, date(2026, 6, 1))
    huge = v.Sale(v.Home(4000, 5, 4, 1980, "single_family", *ORIGIN), 3e6, date(2026, 6, 1))
    old = v.Sale(v.Home(1850, 3, 2.5, 1980, "single_family", *ORIGIN), 7e5, date(2024, 1, 1))
    comps = v.select_comps(SUBJECT, [*sales, far, condo, huge, old], TODAY)
    ids = {c.sale.id for c in comps}
    assert 5 <= len(comps) <= 15 and not ({far.id, condo.id, huge.id, old.id} - {""} & ids)
    assert all(c.sale.home.property_type == "single_family" and c.miles <= 1.0 for c in comps)
    assert comps == sorted(comps, key=lambda c: c.similarity, reverse=True)


def test_noiseless_comps_recover_the_true_value_but_stay_unpublished_without_calibration():
    out = v.comp_value(SUBJECT, market(40, 2), TODAY, price_index=index)
    assert out is not None and out.method == "comps" and out.mid is not None
    truth = true_price(SUBJECT, TODAY)
    assert abs(out.mid / truth - 1) < 0.02
    assert out.low <= truth <= out.high
    assert (out.interval, out.confidence, out.measured_coverage) == ("uncalibrated", "low", None)
    assert any("Not calibrated" in n for n in out.notes)


def test_the_calibrated_interval_targets_80_percent_and_reports_its_measured_coverage():
    sales = market(160, 11, noise=0.06)
    cal = v.calibrate(sales, price_index=index)
    assert cal is not None and cal.target == 0.8 and cal.log_low < 0 < cal.log_high
    assert cal.train_n >= 30 and cal.holdout_n >= 10
    assert 0.65 <= cal.measured_coverage <= 0.97  # measured on later sales it never saw
    out = v.comp_value(SUBJECT, market(40, 2), TODAY, calibration=cal, price_index=index)
    assert out is not None and out.interval == "calibrated" and out.coverage_target == 0.8
    assert out.measured_coverage == round(cal.measured_coverage, 3)
    assert any("80% interval" in n and f"{cal.holdout_n} later sales" in n for n in out.notes)
    assert out.low <= out.mid <= out.high
    # Round-trips through JSON (the backtest script writes it; the worker reads it).
    assert v.Calibration.from_json(cal.to_json()) == cal
    # Too few sales: no calibration rather than a made-up one.
    assert v.calibrate(market(20, 12), price_index=index) is None


def test_backtest_with_a_calibration_scores_only_the_held_out_sales():
    sales = market(160, 11, noise=0.06)
    cal = v.calibrate(sales, price_index=index)
    assert cal is not None
    bands = v.backtest(sales, calibration=cal, price_index=index)
    assert sum(b.n for b in bands) == cal.holdout_n


def test_noisy_or_scarce_comps_widen_the_range_and_lower_confidence():
    noisy = v.comp_value(SUBJECT, market(40, 3, noise=0.12), TODAY, price_index=index)
    assert noisy is not None and noisy.confidence in {"moderate", "low"}
    assert noisy.inputs["dispersion"] > 0.08
    assert v.comp_value(SUBJECT, market(2, 4), TODAY) is None


def test_the_fit_shrinks_to_the_priors_without_variation():
    same = [v.Sale(SUBJECT, 1_000_000, date(2026, m, 1), id=str(m)) for m in range(1, 7)]
    beta = v.fit_adjustments(v.select_comps(SUBJECT, same, TODAY), TODAY)
    for k, prior in v.PRIORS.items():
        assert beta[k] == pytest.approx(prior, abs=1e-6)


def test_backtest_scores_by_price_band_from_earlier_sales_only():
    bands = v.backtest(market(60, 5, noise=0.03), price_index=index)
    assert bands and sum(b.n for b in bands) > 20
    for b in bands:
        assert 0 <= b.coverage <= 1 and b.median_abs_error < 0.08
    assert [b.band for b in bands] == [label for *_, label in v.BANDS if label in {b.band for b in bands}]


def test_miles_is_a_great_circle():
    a = v.Home(1, 1, 1, 2000, "x", 33.0, -117.0)
    b = v.Home(1, 1, 1, 2000, "x", 34.0, -117.0)
    assert v.miles(a, b) == pytest.approx(69.1, abs=0.2) and math.isclose(v.miles(a, a), 0)


def test_the_backtest_script_reads_the_documented_csv(tmp_path, capsys):
    import csv as _csv
    import json as _json
    import sys as _sys
    from pathlib import Path as _Path

    _sys.path.insert(0, str(_Path(__file__).resolve().parent.parent / "scripts"))
    import backtest_valuation as script

    path = tmp_path / "closed.csv"
    with path.open("w", newline="") as f:
        w = _csv.writer(f)
        w.writerow(script.COLUMNS)
        for s in market(40, 7, noise=0.03):
            h = s.home
            w.writerow([s.id, s.closed.isoformat(), round(s.price), h.sqft, h.beds, h.baths, h.year_built, h.property_type, h.lat, h.lon, str(h.pool).lower(), ""])
        w.writerow(["bad", "not-a-date", 1, 1, 1, 1, 1, "condo", 0, 0, "false", ""])
    out = tmp_path / "bands.json"
    assert script.main([str(path), "--json", str(out)]) == 0
    printed = capsys.readouterr()
    assert "40 closed sales" in printed.out and "line 42: skipped" in printed.err
    assert "Not enough sales to calibrate" in printed.out  # 40 sales: too few to fit and measure
    table = _json.loads(out.read_text())
    assert table["sales"] == 40 and table["calibration"] is None and table["bands"]
