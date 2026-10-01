"""The budget optimizer (Listing Prep P4, SPEC_LISTING_PREP.md §5.5).

Maximizes **risk-adjusted net gain** (improvements.py) under a budget:

* a 0/1 choice per item, **at most one per group** (alternatives such as refinishing vs
  replacing, carpet vs LVP), **prerequisites** paid once however many items need them
  (patch before paint), and items that can't finish before listing already excluded;
* exact: every combination of prerequisites is tried, and for each, a multiple-choice
  knapsack over the rest by dynamic programming in $50 steps, costs rounded **up**, so
  a plan never exceeds its budget at the high end of its costs;
* items with a risk-adjusted net gain ≤ 0 are never chosen for themselves (they're
  listed under "actions to avoid"); a prerequisite with no value of its own is bought
  only when what needs it more than pays for it;
* dollars left when nothing more clears the bar are reported, not forced.

`scenarios` runs the standard budgets ($5K, $10K, $25K, $50K) and the seller's, and
`marginal` what each next $5K buys.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from itertools import combinations

from agents.listing_prep.improvements import Estimate, round_up

STEP = 50.0  # budget resolution in dollars
STANDARD_BUDGETS = (5_000, 10_000, 25_000, 50_000)


@dataclass(frozen=True)
class Plan:
    budget: float
    items: tuple[str, ...]  # chosen item keys (prerequisites included), catalog order
    cost_low: float
    cost_high: float
    value_low: float
    value_high: float
    risk_net: float  # the objective: Σ risk-adjusted net gain
    unspent: float  # budget − high cost
    value_after: tuple[float, float] | None = None  # the property's range after the work, if a range was given


@dataclass(frozen=True)
class Outcome:
    scenarios: list[Plan]
    marginal: list[dict]
    avoid: list[Estimate]
    not_estimated: list[Estimate] = field(default_factory=list)


def _options(estimates: Sequence[Estimate]) -> tuple[dict[str, Estimate], list[Estimate], dict[str, Estimate]]:
    by_key = {e.key: e for e in estimates}
    prereq_keys = {r for e in estimates for r in e.requires}
    prereqs = {k: by_key[k] for k in prereq_keys if k in by_key and by_key[k].cost_high is not None}
    regular = [e for e in estimates if e.key not in prereq_keys and e.status == "candidate" and (e.risk_net or 0) > 0]
    return by_key, regular, prereqs


def optimize(estimates: Sequence[Estimate], budget: float, value_range: tuple[float, float] | None = None) -> Plan:
    by_key, regular, prereqs = _options(estimates)
    cap = int(budget // STEP)
    best: tuple[float, list[str]] = (0.0, [])
    keys = sorted(prereqs)
    for r in range(len(keys) + 1):
        for chosen in combinations(keys, r):
            pre_cost = sum(round_up(prereqs[k].cost_high, STEP) for k in chosen)  # type: ignore[arg-type]
            if pre_cost > cap:
                continue
            pre_net = sum(prereqs[k].risk_net or 0.0 for k in chosen)
            have = set(chosen)
            usable = [e for e in regular if set(e.requires) <= have]
            value, picks = _mck(usable, cap - pre_cost)
            total = pre_net + value
            # A prerequisite is only worth buying for what needs it (or its own net gain).
            if chosen and any(not any(k in by_key[p].requires for p in picks) and (prereqs[k].risk_net or 0) <= 0 for k in chosen):
                continue
            if total > best[0] + 1e-9:
                best = (total, [*chosen, *picks])
    order = {e.key: i for i, e in enumerate(estimates)}
    items = tuple(sorted(best[1], key=lambda k: order[k]))
    chosen_e = [by_key[k] for k in items]
    cost_low = sum(e.cost_low or 0 for e in chosen_e)
    cost_high = sum(e.cost_high or 0 for e in chosen_e)
    v_low = sum(e.value_low or 0 for e in chosen_e)
    v_high = sum(e.value_high or 0 for e in chosen_e)
    after = (value_range[0] + v_low, value_range[1] + v_high) if value_range else None
    return Plan(budget, items, round(cost_low, 2), round(cost_high, 2), round(v_low, 2), round(v_high, 2), round(best[0], 2), round(budget - cost_high, 2), after)


def _mck(options: Iterable[Estimate], cap: int) -> tuple[float, list[str]]:
    """Multiple-choice knapsack: at most one option per group (ungrouped items are their
    own group), maximizing Σ risk_net with Σ cost (in STEP units, rounded up) ≤ cap."""
    groups: dict[str, list[Estimate]] = {}
    for e in options:
        groups.setdefault(e.group or f"_{e.key}", []).append(e)
    if cap < 0:
        return 0.0, []
    dp = [0.0] * (cap + 1)
    choice: list[list[int]] = []
    glist = list(groups.values())
    for opts in glist:
        new = dp[:]
        pick = [-1] * (cap + 1)
        for idx, e in enumerate(opts):
            c = round_up(e.cost_high or 0.0, STEP)
            v = e.risk_net or 0.0
            for b in range(cap, c - 1, -1):
                if dp[b - c] + v > new[b] + 1e-9:
                    new[b] = dp[b - c] + v
                    pick[b] = idx
        choice.append(pick)
        dp = new
    # Walk back from the full budget.
    b, picks = cap, []
    for gi in range(len(glist) - 1, -1, -1):
        idx = choice[gi][b]
        if idx >= 0:
            e = glist[gi][idx]
            picks.append(e.key)
            b -= round_up(e.cost_high or 0.0, STEP)
    return dp[cap], picks


def scenarios(estimates: Sequence[Estimate], seller_budget: float | None = None, value_range: tuple[float, float] | None = None) -> Outcome:
    budgets = sorted({*STANDARD_BUDGETS, *([seller_budget] if seller_budget else [])})
    plans = [optimize(estimates, b, value_range) for b in budgets]
    return Outcome(plans, marginal(estimates, max(budgets)), [e for e in estimates if e.status == "avoid"], [e for e in estimates if e.status in ("no_prior", "no_price", "no_quantity", "too_slow")])


def marginal(estimates: Sequence[Estimate], up_to: float, step: float = 5_000) -> list[dict]:
    """What each next `step` dollars buys: the plan's added and dropped items and the gain."""
    rows, prev = [], optimize(estimates, 0)
    b = step
    while b <= up_to + 1e-9:
        plan = optimize(estimates, b)
        rows.append(
            {
                "budget": b,
                "adds": [k for k in plan.items if k not in prev.items],
                "drops": [k for k in prev.items if k not in plan.items],
                "gain": round(plan.risk_net - prev.risk_net, 2),
                "risk_net": plan.risk_net,
            }
        )
        prev = plan
        b += step
    return rows
