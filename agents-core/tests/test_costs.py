from __future__ import annotations

import json
import time

import pytest

from agents_core.costs import BudgetExceeded, CostTracker, summarize_costs


def test_record_appends_jsonl_and_tracks_total(tmp_path):
    costs_path = tmp_path / "costs.jsonl"
    tracker = CostTracker(agent="demo", max_run_usd=1.0, costs_path=costs_path)
    tracker.record(model="m", input_tokens=10, output_tokens=5, cost_usd=0.1)
    tracker.record(model="m", input_tokens=10, output_tokens=5, cost_usd=0.2)

    assert tracker.total_usd == pytest.approx(0.3)
    assert tracker.calls == 2
    lines = costs_path.read_text().strip().splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["agent"] == "demo"


def test_record_raises_when_budget_exceeded(tmp_path):
    tracker = CostTracker(agent="demo", max_run_usd=0.05, costs_path=tmp_path / "costs.jsonl")
    with pytest.raises(BudgetExceeded):
        tracker.record(model="m", input_tokens=1, output_tokens=1, cost_usd=0.10)


def test_summarize_costs_filters_by_agent_and_period(tmp_path):
    costs_path = tmp_path / "costs.jsonl"
    now = time.time()
    rows = [
        {"ts": now, "agent": "demo", "cost_usd": 0.1},
        {"ts": now, "agent": "demo", "cost_usd": 0.05},
        {"ts": now, "agent": "other", "cost_usd": 5.0},
    ]
    costs_path.write_text("\n".join(json.dumps(r) for r in rows) + "\n")

    summary = summarize_costs("demo", costs_path=costs_path)
    assert summary.agent == "demo"
    assert summary.calls == 2
    assert summary.total_usd == pytest.approx(0.15)


def test_summarize_costs_excludes_other_periods(tmp_path):
    costs_path = tmp_path / "costs.jsonl"
    old_ts = time.mktime(time.strptime("2020-01-15", "%Y-%m-%d"))
    rows = [{"ts": old_ts, "agent": "demo", "cost_usd": 1.0}]
    costs_path.write_text("\n".join(json.dumps(r) for r in rows) + "\n")

    summary = summarize_costs("demo", costs_path=costs_path, period="2026-09")
    assert summary.calls == 0
    assert summary.total_usd == 0.0


def test_summarize_costs_missing_file_returns_zero(tmp_path):
    summary = summarize_costs("demo", costs_path=tmp_path / "does-not-exist.jsonl")
    assert summary.calls == 0
    assert summary.total_usd == 0.0
