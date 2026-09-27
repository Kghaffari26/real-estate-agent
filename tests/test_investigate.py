"""The metro investigator (§6.3): tools over a World snapshot, the guard on the final
explanation, the deterministic template, target selection, and the loop itself run
against a scripted client (no network)."""

from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from agents_core.agent_loop import LoopBudget
from agents_core.costs import CostTracker
from agents_core.guards import verify_numbers
from agents_core.llm import LLM
from pydantic import ValidationError

from agents.real_estate import investigate as inv
from agents.real_estate.analyze import guard_facts


def _dates(n: int = 36) -> list[str]:
    end = date(2026, 5, 31)
    out = []
    for _ in range(n):
        out.append(end)
        end = end.replace(day=1) - timedelta(days=1)
    return [d.isoformat() for d in sorted(out)]


def _metro(slug: str, name: str, homes: int, price0: float, growth: float, inv_growth: float) -> inv.WorldMetro:
    n = 36
    return inv.WorldMetro(
        slug=slug,
        name=name,
        region=inv.region_for(name),
        homes_sold_12m=homes,
        dates=_dates(n),
        series={
            "median_sale_price": [round(price0 * (1 + growth) ** i) for i in range(n)],
            "inventory": [round(4000 * (1 + inv_growth) ** i) for i in range(n)],
            "homes_sold": [1000 + (i % 12) * 10 for i in range(n)],
            "price_drops": [0.05 + 0.001 * i for i in range(n)],
            "median_dom": [30 + i % 5 for i in range(n)],
            "months_of_supply": [3.0 + 0.05 * i for i in range(n)],
            "zori": [None] * n,
        },
        flags=[inv.WorldFlag(id="inventory_surge", label="Inventory +55% YoY", severity="major")],
    )


@pytest.fixture
def world() -> inv.World:
    metros = [
        _metro("austin-tx", "Austin, TX", 30000, 400000, -0.006, 0.035),
        _metro("dallas-tx", "Dallas, TX", 60000, 380000, 0.001, 0.02),
        _metro("houston-tx", "Houston, TX", 80000, 330000, 0.002, 0.015),
        _metro("san-antonio-tx", "San Antonio, TX", 25000, 300000, -0.001, 0.02),
        _metro("atlanta-ga", "Atlanta, GA", 70000, 390000, 0.001, 0.01),
        _metro("nashville-tn", "Nashville, TN", 28000, 450000, 0.002, 0.012),
        _metro("miami-fl", "Miami, FL", 27000, 600000, -0.002, 0.03),
        _metro("seattle-wa", "Seattle, WA", 35000, 750000, 0.003, 0.01),
    ]
    return inv.World(
        data_through="2026-05-31",
        metros={m.slug: m for m in metros},
        national_dates=_dates(),
        national_series={
            "median_sale_price": [400000 * 1.002**i for i in range(36)],
            "inventory": [1_500_000 * 1.01**i for i in range(36)],
        },
        national_temperature={"label": "Cool", "score": 35, "relative_to": "its own 3-year history"},
        rate_dates=[f"2026-0{1 + i // 5}-{1 + (i % 5) * 5:02d}" for i in range(20)],
        mortgage30=[round(6.8 + 0.01 * i, 2) for i in range(20)],
    )


def test_region_for_uses_census_regions():
    assert inv.region_for("Houston, TX") == "South"
    assert inv.region_for("New York, NY") == "Northeast"
    assert inv.region_for("Kansas City, MO") == "Midwest"
    assert inv.region_for("Portland, OR-WA") == "West"
    assert inv.region_for("Nowhere") is None


def test_series_tool_speaks_human_units(world):
    out = inv.Toolbox(world).metro_series(inv.SeriesQuery(slug="austin-tx", metrics=["price_drops", "inventory"], months=3))
    assert out["months"] == ["2026-03", "2026-04", "2026-05"]
    drops = out["series"]["price_drops"]
    assert drops["unit"] == "percent" and drops["values"] == [8.3, 8.4, 8.5]  # 0.085 -> 8.5
    assert drops["latest"] == {"value": 8.5, "yoy_pp": 1.2}
    assert out["series"]["inventory"]["latest"]["yoy_pct"] == pytest.approx(51.1, abs=0.1)


def test_peers_are_the_5_closest_by_homes_sold_in_the_same_region(world):
    out = inv.Toolbox(world).peers(inv.PeerQuery(slug="austin-tx", metric="inventory"))
    assert out["region"] == "South" and out["n_peers"] == 5
    names = [p["metro"] for p in out["peers"]]
    assert "Seattle, WA" not in names  # West
    assert names[:3] == ["Nashville, TN", "Miami, FL", "San Antonio, TX"]  # |homes - 30000| ascending
    assert out["peer_median_yoy_pct"] is not None
    assert out["rank_among_metro_and_peers"] == 1  # Austin's inventory grows fastest


def test_rates_and_episodes(world):
    box = inv.Toolbox(world)
    rates = box.rates(inv.RateQuery(weeks=4))
    assert rates["mortgage30"] == [6.96, 6.97, 6.98, 6.99]
    assert rates["change_pp"] == 0.03
    ep = box.episodes(inv.EpisodeQuery(slug="austin-tx", metric="inventory"))
    assert ep["current"]["month"] == "2026-05"
    assert ep["months_searched"] == 21  # 24 YoY months minus the latest 3
    assert ep["similar_episodes"] and ep["similar_episodes"][0]["months"] == 21


def test_unknown_slug_is_a_clean_tool_error(world):
    from agents_core.agent_loop import ToolError

    with pytest.raises(ToolError):
        inv.Toolbox(world).peers(inv.PeerQuery(slug="atlantis", metric="inventory"))


def test_rate_tool_is_not_offered_without_rate_data(world):
    no_rates = world.model_copy(update={"mortgage30": [None] * 20})
    target = inv.select_targets(no_rates, {}, {"austin-tx": -0.07})[0]
    loop, _ = inv.build_loop(LLM(CostTracker(agent="t", run_id="t")), no_rates, target)
    assert "get_rate_history" not in loop.tools
    loop, _ = inv.build_loop(LLM(CostTracker(agent="t", run_id="t")), world, target)
    assert "get_rate_history" in loop.tools


def test_finish_requires_4_to_6_sentences_and_known_metric_keys():
    ok = "One. Two. Three. Four."
    assert inv.InvestigationDraft(explanation=ok, cited_metrics=["inventory"]).explanation == ok
    with pytest.raises(ValidationError):
        inv.InvestigationDraft(explanation="One. Two. Three.", cited_metrics=["inventory"])
    with pytest.raises(ValidationError):
        inv.InvestigationDraft(explanation=ok, cited_metrics=["mortgage_vibes"])
    # decimals and "U.S." don't end sentences
    assert inv.count_sentences("Prices fell 3.1% in the U.S. market. Inventory rose. A. B.") == 4
    assert inv.count_sentences("St. Louis prices rose. Ft. Myers too. Supply fell. Sales held.") == 4
    assert inv.first_sentence("St. Louis prices rose. Supply fell.") == "St. Louis prices rose."


def test_template_is_4_to_6_sentences_and_passes_the_number_guard(world):
    target = inv.select_targets(world, {"austin-tx": world.metros["austin-tx"].flags}, {})[0]
    draft = inv.template_investigation(world, target)
    assert 4 <= inv.count_sentences(draft.explanation) <= 6
    box = inv.Toolbox(world)
    box.metro_series(inv.SeriesQuery(slug="austin-tx", metrics=["inventory", "homes_sold", "price_drops", "median_dom"]))
    box.peers(inv.PeerQuery(slug="austin-tx", metric=target.trigger_metric))
    box.rates(inv.RateQuery(weeks=52))
    facts = guard_facts({"task": inv.task_facts(target, world), "seen": box.seen})
    assert verify_numbers(draft.explanation, facts).ok, verify_numbers(draft.explanation, facts).unsupported


def test_select_targets_prefers_new_major_flags_largest_first_then_top_mover(world):
    major = [inv.WorldFlag(id="price_decline", label="Median price -9.1% YoY", severity="major")]
    targets = inv.select_targets(
        world,
        {"austin-tx": major, "houston-tx": major, "dallas-tx": major, "atlanta-ga": major, "miami-fl": []},
        {"seattle-wa": 0.2},
    )
    assert [t.slug for t in targets] == ["houston-tx", "atlanta-ga", "dallas-tx"]  # max 3, by homes sold
    assert targets[0].trigger == "new_major_flag" and targets[0].trigger_metric == "median_sale_price"
    [mover] = inv.select_targets(world, {"austin-tx": []}, {"seattle-wa": 0.021, "miami-fl": -0.043})
    assert (mover.slug, mover.trigger, mover.trigger_label) == ("miami-fl", "top_mover", "Median price -4.3% YoY")


# ---- the loop, against a scripted Messages API ------------------------------------


class ScriptedClient:
    """Plays back a list of tool-use turns (each a list of (name, input)) in order."""

    def __init__(self, turns: list[list[tuple[str, dict[str, Any]]]]) -> None:
        self.turns = list(turns)
        self.requests: list[dict[str, Any]] = []
        usage = SimpleNamespace(input_tokens=1500, output_tokens=150, cache_creation_input_tokens=0, cache_read_input_tokens=0)

        def create(**params: Any) -> Any:
            self.requests.append(params)
            blocks = [
                SimpleNamespace(type="tool_use", id=f"t{len(self.requests)}_{i}", name=name, input=args)
                for i, (name, args) in enumerate(self.turns.pop(0))
            ]
            return SimpleNamespace(content=blocks, usage=usage, stop_reason="tool_use")

        self.messages = SimpleNamespace(create=create)


def _llm(tmp_path, monkeypatch, client: ScriptedClient) -> LLM:
    monkeypatch.setenv("AGENTS_CORE_DATA_DIR", str(tmp_path))
    return LLM(CostTracker(agent="t", run_id="t", path=tmp_path / "costs.jsonl"), client=client)


def _target(world: inv.World) -> inv.Target:
    return inv.select_targets(world, {"austin-tx": world.metros["austin-tx"].flags}, {})[0]


GOOD = (
    "Austin's active inventory is up 51.1% from a year earlier. Its median sale price fell over the same"
    " period. Among its closest peers in the South, inventory grew more slowly. The data points to rising"
    " supply rather than a regional shift."
)


def test_loop_finishes_with_a_guarded_explanation_and_filters_citations(tmp_path, monkeypatch, world):
    client = ScriptedClient(
        [
            [("get_metro_series", {"slug": "austin-tx", "metrics": ["inventory", "median_sale_price"]})],
            [("compare_to_peers", {"slug": "austin-tx", "metric": "inventory"})],
            [("finish", {"explanation": GOOD, "cited_metrics": ["inventory", "median_sale_price", "zori"]})],
        ]
    )
    result = inv.run_investigation(_llm(tmp_path, monkeypatch, client), world, _target(world))
    assert result.ok and result.stop_reason == "finished" and result.narrative_source == "llm"
    assert result.tools_called() == ["get_metro_series", "compare_to_peers"]
    assert result.result.cited_metrics == ["inventory", "median_sale_price"]  # zori never looked at
    assert result.steps == 3
    # every tool output reached the model wrapped as untrusted data
    last = client.requests[-1]["messages"][-1]["content"][0]["content"]
    assert last.startswith("<untrusted-tool-output")


def test_invented_number_is_retried_then_replaced_by_the_template(tmp_path, monkeypatch, world):
    bad = GOOD.replace("51.1%", "62%")
    client = ScriptedClient(
        [
            [("get_metro_series", {"slug": "austin-tx", "metrics": ["inventory"]})],
            [("finish", {"explanation": bad, "cited_metrics": ["inventory"]})],
            [("finish", {"explanation": bad, "cited_metrics": ["inventory"]})],
        ]
    )
    result = inv.run_investigation(_llm(tmp_path, monkeypatch, client), world, _target(world))
    assert result.ok and result.narrative_source == "template"
    assert result.unsupported == ["62%"]
    assert "retry" in client.requests[-1]["messages"][-1]["content"][0]["content"].lower() or result.guard_attempts == 2
    assert (tmp_path / "guard_failures.jsonl").exists()


def test_step_budget_stops_gracefully(tmp_path, monkeypatch, world):
    client = ScriptedClient([[("get_rate_history", {"weeks": 8})]] * 3)
    result = inv.run_investigation(
        _llm(tmp_path, monkeypatch, client), world, _target(world), budget=LoopBudget(max_steps=3, max_usd=0.05)
    )
    assert not result.ok and result.stop_reason == "max_steps" and result.partial
    assert result.tools_called() == ["get_rate_history"] * 3


def test_usd_budget_is_checked_before_each_call(tmp_path, monkeypatch, world):
    client = ScriptedClient([[("get_rate_history", {"weeks": 8})]] * 8)
    result = inv.run_investigation(
        _llm(tmp_path, monkeypatch, client), world, _target(world), budget=LoopBudget(max_steps=8, max_usd=0.001)
    )
    assert result.stop_reason == "max_usd" and client.requests == []  # never sent a call it couldn't afford


def test_record_shape(world):
    target = _target(world)
    draft = inv.template_investigation(world, target)
    rec = inv.investigation_record(target, None, draft, "template")
    assert rec["stop_reason"] == "not_run" and rec["model"] is None and rec["cost_usd"] == 0.0
    assert rec["prompt_version"] == inv.PROMPT_VERSION


# ---- deterministic replay of trajectories recorded by the live eval run ------------------


@pytest.mark.parametrize(
    "case_id",
    ["price-gainer", "inventory-surge", "inventory-drop", "cold-market", "hot-market", "no-rate-data"],
)
def test_recorded_trajectories_replay_deterministically(case_id, tmp_path, monkeypatch):
    """Each fixture metro's live trajectory (evals/real_estate/trajectories/, saved with
    RE_SAVE_TRAJECTORIES) replays offline through the same loop: same tool calls, same
    guarded result. `strict=True` fails if the loop diverges from the recording."""
    from pathlib import Path

    from agents_core.agent_loop import ReplayClient, Trajectory
    from agents_core.evals import EvalCase

    from evals.real_estate import suites

    path = Path(__file__).parent.parent / "evals" / "real_estate" / "trajectories" / f"{case_id}.json"
    case: EvalCase = next(c for c in suites.INVESTIGATOR.cases if c.id == case_id)
    world, target = suites._target(case)
    monkeypatch.setenv("AGENTS_CORE_DATA_DIR", str(tmp_path))
    llm = LLM(CostTracker(agent="t", run_id="t", path=tmp_path / "c.jsonl"), client=ReplayClient(path, strict=True))
    loop, box = inv.build_loop(llm, world, target)
    result = loop.run(inv.task_prompt(target, world))

    recorded = [
        b["name"] for r in Trajectory.load(path).responses for b in r["content"] if b.get("type") == "tool_use"
    ]
    assert result.tools_called() == [t for t in recorded if t != "finish"]
    assert result.ok and result.stop_reason == "finished" and result.narrative_source == "llm"
    assert result.steps <= inv.BUDGET.max_steps
    assert set(case.expected["required_tools"]) <= set(result.tools_called())
    assert not set(case.expected["forbidden_tools"]) & set(result.tools_called())
    assert 4 <= inv.count_sentences(result.result.explanation) <= 6
    assert verify_numbers(result.result.explanation, guard_facts({"task": inv.task_facts(target, world), "seen": box.seen})).ok
