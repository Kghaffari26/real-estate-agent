"""The GitHub workflows' contract with agents-core's reusable workflows (v0.3.0):
they declare no permissions of their own, so each calling job must grant them."""

from __future__ import annotations

from pathlib import Path

import yaml

WORKFLOWS = Path(__file__).parent.parent / ".github" / "workflows"


def _jobs(name: str) -> dict:
    return yaml.safe_load((WORKFLOWS / name).read_text())["jobs"]


def test_agent_workflow_pins_v0_3_0_and_grants_contents_write_only():
    [job] = _jobs("agent-real-estate.yml").values()
    assert job["uses"] == "Kghaffari26/agents-core/.github/workflows/run-agent.yml@v0.3.0"
    # contents: write pushes data/ and the data branch; this agent opens no issues.
    assert job["permissions"] == {"contents": "write"}
    assert job["with"]["agent"] == "real_estate"
    assert "public-data" not in job["with"].get("cache_path", "")  # restored from the data branch


def test_evals_workflow_calls_run_evals_with_a_spend_cap_and_read_only_token():
    [job] = _jobs("evals.yml").values()
    assert job["uses"] == "Kghaffari26/agents-core/.github/workflows/run-evals.yml@v0.3.0"
    assert job["permissions"] == {"contents": "read"}
    assert float(job["with"]["max_usd"]) <= 1.0
    assert "agents-evals run" in job["with"]["eval_command"]
