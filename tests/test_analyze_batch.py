"""The LLM brief path (SPEC_REAL_ESTATE.md §7.4, §11 `test_analyze_batch.py`):
batch success, partial failure, guard retry/fallback, and the batch-timeout
synchronous fallback — through the real `agents_core.llm.LLM` with a fake
Anthropic client, so the guard, cost logging and retry logic are agents-core's own.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest
from agents_core.costs import CostTracker
from agents_core.llm import LLM

from agents.real_estate import analyze
from evals.real_estate.fixtures import (
    METRO_FACTS,
    NATIONAL_ALERTS,
    NATIONAL_FACTS,
    NATIONAL_MOVER_COUNTS,
)


def _message(payload: dict[str, Any] | None = None, *, parsed: Any = None, stop: str = "end_turn"):
    text = json.dumps(payload) if payload is not None else ""
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)],
        usage=SimpleNamespace(input_tokens=1000, output_tokens=100, cache_creation_input_tokens=0, cache_read_input_tokens=0),
        stop_reason=stop,
        parsed_output=parsed,
    )


class FakeBatches:
    def __init__(self, results: dict[str, Any], *, ends: bool = True) -> None:
        self._results = results
        self._ends = ends
        self.created: list[Any] = []
        self.cancelled = False

    def create(self, requests):
        self.created = list(requests)
        return SimpleNamespace(id="batch_1")

    def retrieve(self, batch_id):
        return SimpleNamespace(processing_status="ended" if self._ends else "in_progress")

    def cancel(self, batch_id):
        self.cancelled = True

    def results(self, batch_id):
        for req in self.created:
            cid = req["custom_id"]
            outcome = self._results.get(cid)
            if outcome is None:
                yield SimpleNamespace(custom_id=cid, result=SimpleNamespace(type="errored", error=SimpleNamespace(type="api_error")))
            else:
                yield SimpleNamespace(custom_id=cid, result=SimpleNamespace(type="succeeded", message=_message(outcome)))


class FakeMessages:
    def __init__(self, batches: FakeBatches, sync_payloads: list[dict[str, Any]]) -> None:
        self.batches = batches
        self._sync = list(sync_payloads)
        self.parse_calls: list[dict[str, Any]] = []

    def parse(self, *, output_format, **params):
        self.parse_calls.append(params)
        payload = self._sync.pop(0)
        return _message(payload, parsed=output_format.model_validate(payload))


def _llm(tmp_path, monkeypatch, batch_results, sync_payloads=(), *, ends=True):
    monkeypatch.setenv("AGENTS_CORE_GUARD_FAILURES_PATH", str(tmp_path / "guard_failures.jsonl"))
    batches = FakeBatches(batch_results, ends=ends)
    messages = FakeMessages(batches, list(sync_payloads))
    tracker = CostTracker(agent="real_estate", run_id="test", path=tmp_path / "costs.jsonl")
    return LLM(tracker, client=SimpleNamespace(messages=messages), sleep=lambda s: None), messages, tracker


AUSTIN = METRO_FACTS[0]  # price 550000, +9.4% YoY, inventory -18.2%, temp 91
BATON_ROUGE = METRO_FACTS[1]
GOOD_AUSTIN = {
    "text": "Austin's median sale price reached $550,000, up 9.4% from a year earlier. "
    "Inventory fell 18.2% and homes sold in a median 12 days. "
    "The market is Hot relative to the 50 largest metros.",
    "key_points": ["Median price +9.4% YoY", "Inventory -18.2% YoY", "Temperature 91/100"],
}
BAD_NUMBER = {"text": "Prices rose 12.5% as buyers returned.", "key_points": []}


def test_batch_success_gives_llm_briefs_with_model_and_citations(tmp_path, monkeypatch):
    llm, messages, tracker = _llm(tmp_path, monkeypatch, {"austin-tx": GOOD_AUSTIN})
    briefs, batch_fallback = analyze.llm_metro_briefs(llm, {"austin-tx": AUSTIN}, batch_timeout_seconds=60)

    brief = briefs["austin-tx"]
    assert batch_fallback is False
    assert brief.narrative_source == "llm"
    assert brief.model == "claude-haiku-4-5-20251001"
    assert brief.text.startswith("Austin's median sale price")
    assert [c.name for c in brief.citations] == ["Redfin Data Center"]
    assert messages.parse_calls == []  # no sync calls: the batch result passed the guard
    # One batch request per metro, custom_id = slug, fast tier, with the facts in the prompt
    (req,) = messages.batches.created
    assert req["custom_id"] == "austin-tx"
    assert req["params"]["model"] == "claude-haiku-4-5-20251001"
    assert '"median_sale_price"' in req["params"]["messages"][0]["content"]
    # Batch pricing is logged (50% of 1000*$1/M + 100*$5/M)
    lines = [json.loads(line) for line in (tmp_path / "costs.jsonl").read_text().splitlines()]
    assert lines[0]["batch"] is True
    assert lines[0]["usd"] == pytest.approx(0.00075)


def test_metro_prompt_excludes_rate_dependent_facts():
    prompt = analyze.metro_prompt(AUSTIN)
    assert "mortgage30_pct" not in prompt and "payment_now" not in prompt
    assert "550000" in prompt


def test_errored_batch_item_falls_back_to_template(tmp_path, monkeypatch):
    llm, messages, _ = _llm(tmp_path, monkeypatch, {"austin-tx": GOOD_AUSTIN})  # baton-rouge errors
    briefs, _ = analyze.llm_metro_briefs(
        llm, {"austin-tx": AUSTIN, "baton-rouge-la": BATON_ROUGE}, batch_timeout_seconds=60
    )
    assert briefs["austin-tx"].narrative_source == "llm"
    fallback = briefs["baton-rouge-la"]
    assert fallback.narrative_source == "template"
    assert fallback.model is None
    assert fallback.text == analyze.template_metro_draft(BATON_ROUGE).text


def test_guard_failure_retries_synchronously_then_uses_the_retry(tmp_path, monkeypatch):
    llm, messages, _ = _llm(tmp_path, monkeypatch, {"austin-tx": BAD_NUMBER}, [GOOD_AUSTIN])
    briefs, _ = analyze.llm_metro_briefs(llm, {"austin-tx": AUSTIN}, batch_timeout_seconds=60)

    assert briefs["austin-tx"].narrative_source == "llm"
    (retry,) = messages.parse_calls
    assert "12.5%" in retry["messages"][-1]["content"]  # the unsupported number is named
    failures = (tmp_path / "guard_failures.jsonl").read_text().splitlines()
    assert json.loads(failures[0])["unsupported"] == ["12.5%"]


def test_guard_failure_twice_uses_template(tmp_path, monkeypatch):
    llm, _, _ = _llm(tmp_path, monkeypatch, {"austin-tx": BAD_NUMBER}, [BAD_NUMBER])
    briefs, _ = analyze.llm_metro_briefs(llm, {"austin-tx": AUSTIN}, batch_timeout_seconds=60)
    assert briefs["austin-tx"].narrative_source == "template"


def test_batch_timeout_cancels_and_runs_synchronously(tmp_path, monkeypatch):
    llm, messages, _ = _llm(tmp_path, monkeypatch, {}, [GOOD_AUSTIN], ends=False)
    briefs, batch_fallback = analyze.llm_metro_briefs(
        llm, {"austin-tx": AUSTIN}, batch_timeout_seconds=60, poll_seconds=30
    )
    assert batch_fallback is True
    assert messages.batches.cancelled is True
    assert len(messages.parse_calls) == 1
    assert briefs["austin-tx"].narrative_source == "llm"


def test_no_changed_metros_makes_no_request(tmp_path, monkeypatch):
    llm, messages, tracker = _llm(tmp_path, monkeypatch, {})
    assert analyze.llm_metro_briefs(llm, {}, batch_timeout_seconds=60) == ({}, False)
    assert messages.batches.created == []
    assert tracker.calls == 0


def test_guard_accepts_numbers_quoted_from_flag_labels():
    facts = {**BATON_ROUGE, "flags": ["Inventory +33% YoY", "Days on market +15 YoY"]}
    guard = analyze.brief_guard(facts)
    ok = analyze.BriefDraft(text="Inventory +33% YoY relative to the 50 largest metros.", key_points=[])
    assert guard(ok).ok


def _national_input():
    movers = {"price_gains": [{"slug": "a", "name": "Austin, TX", "value": 0.094}]}
    return analyze.build_national_input(
        NATIONAL_FACTS[0], NATIONAL_ALERTS[0], movers, NATIONAL_MOVER_COUNTS[0], total_metros=50
    )


def test_national_brief_uses_smart_tier_and_guards_against_alerts_and_counts(tmp_path, monkeypatch):
    national_input = _national_input()
    top = national_input["top_alerts"][0]
    text = f"{top['label']} in {top['metros']} of 50 tracked metros. Austin, TX leads gains at 9.4%."
    llm, messages, _ = _llm(tmp_path, monkeypatch, {}, [{"text": text, "key_points": ["a", "b", "c"]}])
    brief = analyze.llm_national_brief(llm, national_input, lambda: analyze.BriefDraft(text="t", key_points=[]))

    assert brief.narrative_source == "llm"
    assert brief.model == "claude-sonnet-5"
    assert messages.parse_calls[0]["model"] == "claude-sonnet-5"
    assert [c.name for c in brief.citations] == ["Redfin Data Center", "FRED, Federal Reserve Bank of St. Louis"]


def test_national_brief_unusable_output_falls_back_to_template(tmp_path, monkeypatch):
    llm, messages, _ = _llm(tmp_path, monkeypatch, {}, [])

    def truncated(**params):
        return _message(None, stop="max_tokens")

    messages.parse = lambda *, output_format, **params: truncated(**params)
    brief = analyze.llm_national_brief(
        llm, _national_input(), lambda: analyze.BriefDraft(text="template text", key_points=[])
    )
    assert brief.narrative_source == "template"
    assert brief.text == "template text"
