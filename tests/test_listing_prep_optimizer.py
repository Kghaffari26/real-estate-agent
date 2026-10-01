"""Listing Prep P4: improvement estimates and the budget optimizer.

The optimizer's guarantees are checked as properties over many random instances:
never over budget, never a negative-gain item chosen for itself, at most one per group,
prerequisites always present, monotone in the budget, and exactly optimal (against
brute force on small instances)."""

from __future__ import annotations

import itertools
import random

import pytest

from agents.listing_prep import catalog, demand, fair_housing
from agents.listing_prep import improvements as imp
from agents.listing_prep import optimizer as opt

FACTS = {"beds": 3, "baths": 2, "sqft": 1800, "year_built": 1978, "property_type": "single_family"}


def book(**prices: tuple[float, float]) -> dict[str, imp.Price]:
    units = {"interior_paint_walls": "sq_ft_floor_area", "minor_repairs_handyman": "hour", "flooring_lvp": "sq_ft", "flooring_carpet": "sq_ft", "flooring_hardwood_refinish": "sq_ft", "cabinet_refinish": "linear_ft", "professional_cleaning": "each", "staging_partial": "month", "staging_full": "month", "window_replace": "each"}
    return {k: imp.Price(units.get(k, "each"), lo, hi) for k, (lo, hi) in prices.items()}


def finding(category: str, fix_item: str | None, quantity: float | None = None, issue: str = "Worn", room: str = "kitchen") -> dict:
    return {"category": category, "fix_item": fix_item, "quantity": quantity, "issue": issue, "room": room, "status": "confirmed", "condition": 2, "severity": "cosmetic"}


PRIORS = {
    "interior_paint_walls": imp.Prior(1.1, 1.8, "team"),
    "flooring_lvp": imp.Prior(1.05, 1.4, "team"),
    "flooring_carpet": imp.Prior(0.4, 0.8, "team"),
    "professional_cleaning": imp.Prior(1.2, 2.5, "team"),
    "staging_partial": imp.Prior(0.8, 1.6, "team"),
    "staging_full": imp.Prior(0.6, 1.2, "team"),
    "window_replace": imp.Prior(0.6, 0.85, "team"),
}


def test_estimates_cost_value_relevance_and_status():
    findings = [
        finding("paint", "interior_paint_walls", issue="Scuffed walls"),
        finding("flooring", "flooring_lvp", 600, "Worn carpet in the living room", "living"),
        finding("windows_doors", "window_replace", 4, "Fogged windows"),
        finding("cabinets", "cabinet_refinish", None, "Worn cabinet doors"),
        finding("countertops", "countertop_quartz_install", 40, "Laminate counters"),
    ]
    cb = book(interior_paint_walls=(2.5, 4.0), minor_repairs_handyman=(80, 120), flooring_lvp=(6, 9), flooring_carpet=(4, 6), professional_cleaning=(400, 600), staging_partial=(1500, 2500), staging_full=(3000, 5000), window_replace=(900, 1400), cabinet_refinish=(150, 250))
    quotes = [{"item": "interior_paint_walls", "low_usd": 5200, "high_usd": 6100}]
    segs = [{"key": "low_maintenance", "weight": 0.6}, {"key": "more_space", "weight": 0.4}]
    est = {e.key: e for e in imp.estimate_items(findings=findings, facts=FACTS, cost_book=cb, quotes=quotes, priors=PRIORS, segments=segs, days_to_list=8)}
    paint = est["interior_paint_walls"]
    assert (paint.cost_source, paint.cost_low, paint.cost_high) == ("quote", 5200, 6100)  # the quote wins over the cost book
    assert paint.requires == ["minor_repairs_handyman"] and "minor_repairs_handyman" in est  # the prerequisite comes along
    assert est["minor_repairs_handyman"].status == "no_prior" and est["minor_repairs_handyman"].cost_high == 120 * 2  # priced anyway (no repair findings: the 2-hour minimum)
    assert paint.relevance == 1.1  # 60% of demand values it: capped at +10%
    assert paint.confidence == "low" and paint.risk_value == paint.value_low  # Low: the lower bound
    lvp = est["flooring_lvp"]
    assert (lvp.quantity, lvp.cost_low, lvp.cost_high) == (600, 3600, 5400)
    assert est["flooring_carpet"].group == "flooring" and est["flooring_carpet"].quantity == 600  # the alternative, same area
    assert est["flooring_hardwood_refinish"].status == "no_price"
    assert est["window_replace"].status == "too_slow"  # 10 days > 8 to listing
    assert est["cabinet_refinish"].status == "no_quantity" and "linear ft" in est["cabinet_refinish"].reason
    assert est["countertop_quartz_install"].status == "too_slow"
    assert est["professional_cleaning"].status == "candidate" and est["staging_partial"].status in ("candidate", "avoid")
    # An item whose conservative value doesn't cover its high cost is avoided, with the reason.
    assert est["flooring_carpet"].status == "avoid" and "doesn’t pay for itself" in est["flooring_carpet"].reason
    assert est["professional_cleaning"].relevance == 1.0  # no particular need: neutral
    # No prior → not enough evidence, never a guess.
    cb2 = {**cb, "light_fixture_replace": imp.Price("each", 150, 300)}
    lights = {e.key: e for e in imp.estimate_items(findings=[finding("lighting", "light_fixture_replace")], facts=FACTS, cost_book=cb2, priors=PRIORS)}["light_fixture_replace"]
    assert lights.status == "no_prior" and "Not enough evidence" in lights.reason and lights.value_low is None


def test_relevance_is_bounded_and_neutral_without_demand():
    item = catalog.BY_KEY["home_office_setup"]
    assert imp.relevance(item, []) == 1.0
    assert imp.relevance(item, [{"key": "luxury", "weight": 1.0}]) == 0.9
    assert imp.relevance(item, [{"key": "work_from_home", "weight": 0.2}]) == pytest.approx(0.98)
    assert imp.relevance(catalog.BY_KEY["professional_cleaning"], [{"key": "luxury", "weight": 1.0}]) == 1.0
    assert imp.risk_value(100, 200, "high") == 150 and imp.risk_value(100, 200, "moderate") == 125 and imp.risk_value(100, 200, "low") == 100


def test_the_catalog_matches_the_cost_book_template_and_its_labels_are_fair_housing_clean():
    from pathlib import Path

    template = Path(__file__).parent.parent / "docs" / "templates" / "cost_book.csv"
    keys = [line.split(",")[0] for line in template.read_text().splitlines()[1:] if line]
    assert sorted(keys) == sorted(catalog.BY_KEY)
    assert all(not fair_housing.violations(i.label) for i in catalog.ITEMS)
    assert all(set(i.needs) <= set(demand.SEGMENTS) for i in catalog.ITEMS)
    assert all(set(i.requires) <= set(catalog.BY_KEY) for i in catalog.ITEMS)


# ---------- the optimizer: properties on random instances ----------


def random_instance(rng: random.Random, n: int) -> list[imp.Estimate]:
    prereqs = [f"pre{i}" for i in range(rng.randint(0, 2))]
    out = []
    for p in prereqs:
        c = rng.uniform(200, 1500)
        out.append(imp.Estimate(p, p, "no_prior", cost_low=c * 0.8, cost_high=c, value_low=0, value_high=0, risk_value=0, risk_net=-c))
    groups = ["g1", "g2", None, None, None]
    for i in range(n):
        c = rng.uniform(300, 12_000)
        v = c * rng.uniform(0.5, 2.2)
        req = [rng.choice(prereqs)] if prereqs and rng.random() < 0.35 else []
        status = "candidate" if v - c > 0 else "avoid"
        out.append(imp.Estimate(f"i{i}", f"i{i}", status, cost_low=c * 0.85, cost_high=c, value_low=v, value_high=v * 1.3, risk_value=v, risk_net=v - c, group=rng.choice(groups), requires=req))
    return out


def feasible(est: list[imp.Estimate], keys: tuple[str, ...], budget: float) -> bool:
    by = {e.key: e for e in est}
    chosen = set(keys)
    groups = [by[k].group for k in keys if by[k].group]
    return (
        sum(imp.round_up(by[k].cost_high, opt.STEP) for k in keys) <= int(budget // opt.STEP)
        and len(groups) == len(set(groups))
        and all(set(by[k].requires) <= chosen for k in keys)
    )


@pytest.mark.parametrize("seed", range(150))
def test_plans_are_feasible_never_buy_losses_and_grow_with_the_budget(seed):
    rng = random.Random(seed)
    est = random_instance(rng, rng.randint(2, 14))
    by = {e.key: e for e in est}
    prev = None
    for budget in (0, 2_500, 5_000, 10_000, 25_000, 50_000):
        plan = opt.optimize(est, budget)
        assert plan.cost_high <= budget + 1e-6 and plan.unspent >= -1e-6
        assert feasible(est, plan.items, budget)
        for k in plan.items:
            e = by[k]
            if k.startswith("i"):
                assert e.risk_net > 0  # never chosen for itself at a loss
            else:  # a prerequisite: only with something that needs it
                assert any(k in by[j].requires for j in plan.items)
        assert plan.risk_net >= 0
        if prev is not None:
            assert plan.risk_net >= prev.risk_net - 1e-6  # monotone in budget
        prev = plan


@pytest.mark.parametrize("seed", range(60))
def test_the_optimizer_is_exact_against_brute_force(seed):
    rng = random.Random(1000 + seed)
    est = random_instance(rng, rng.randint(2, 9))
    budget = rng.choice([3_000, 8_000, 15_000, 30_000])
    by = {e.key: e for e in est}
    best = 0.0
    keys = [e.key for e in est if e.key.startswith("pre") or (e.status == "candidate" and e.risk_net > 0)]
    for r in range(len(keys) + 1):
        for combo in itertools.combinations(keys, r):
            if feasible(est, combo, budget):
                best = max(best, sum(by[k].risk_net for k in combo))
    assert opt.optimize(est, budget).risk_net == pytest.approx(best, abs=0.02)


def test_scenarios_marginal_avoid_and_value_after():
    est = imp.estimate_items(
        findings=[finding("paint", "interior_paint_walls"), finding("flooring", "flooring_lvp", 600), finding("lighting", "light_fixture_replace")],
        facts=FACTS,
        cost_book=book(interior_paint_walls=(2.5, 4.0), minor_repairs_handyman=(80, 120), flooring_lvp=(6, 9), flooring_carpet=(4, 6), professional_cleaning=(400, 600), staging_partial=(1500, 2500), staging_full=(3000, 5000)),
        priors=PRIORS,
    )
    out = opt.scenarios(est, seller_budget=18_000, value_range=(1_000_000, 1_200_000))
    # At Low confidence only the conservative end counts: an item whose low recovery is
    # under 100% is never bought (carpet 40–80%, staging 60–160% here).
    assert [p.budget for p in out.scenarios] == [5_000, 10_000, 18_000, 25_000, 50_000]
    assert [p.risk_net for p in out.scenarios] == sorted(p.risk_net for p in out.scenarios)
    big = out.scenarios[-1]
    assert "interior_paint_walls" in big.items and "minor_repairs_handyman" in big.items  # patch before paint
    assert sum(1 for k in big.items if catalog.BY_KEY[k].group == "staging") <= 1
    assert big.value_after == (1_000_000 + big.value_low, 1_200_000 + big.value_high)
    assert big.unspent > 0  # nothing more clears the bar: money left, not forced
    assert {e.key for e in out.avoid} >= {"flooring_carpet"}
    assert {e.key for e in out.not_estimated} >= {"light_fixture_replace"}  # no prior, no price
    assert [r["budget"] for r in out.marginal] == [5_000 * i for i in range(1, 11)]
    assert sum(r["gain"] for r in out.marginal) == pytest.approx(big.risk_net, abs=0.05)
