"""The eval suites load and the free one passes (the LLM suites run in the PR gate)."""

from __future__ import annotations

from agents_core.evals import run_suite

from evals.real_estate import suites


def test_template_brief_suite_passes_offline(tmp_path):
    report = run_suite(suites.TEMPLATE_BRIEFS, write=False, evals_dir=tmp_path)
    assert report.usd == 0 and report.n_scored == 14
    assert report.pass_rate == 1.0, [c for c in report.cases if not c.passed]


def test_investigator_suite_has_6_fixture_metros_with_trajectory_scorers():
    assert len(suites.INVESTIGATOR.cases) == 6
    names = {getattr(s, "name", "") for s in suites.INVESTIGATOR.scorers}
    assert {
        "required_tools_called", "forbidden_tools_not_called", "max_steps", "stop_reason", "quality_judge"
    } <= names  # fmt: skip
    world = suites.investigator_world()
    for case in suites.INVESTIGATOR.cases:
        assert case.input["slug"] in world.metros
    no_rates = next(c for c in suites.INVESTIGATOR.cases if c.input["drop_rates"])
    assert no_rates.expected["forbidden_tools"] == ["get_rate_history"]
