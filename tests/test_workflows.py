"""The GitHub workflows' contract with agents-core's reusable workflows (v0.3.1):
they declare no permissions of their own, so each calling job must grant them."""

from __future__ import annotations

from pathlib import Path

import yaml

WORKFLOWS = Path(__file__).parent.parent / ".github" / "workflows"


def _jobs(name: str) -> dict:
    return yaml.safe_load((WORKFLOWS / name).read_text())["jobs"]


def test_agent_workflow_pins_v0_3_1_and_grants_contents_write_only():
    [job] = _jobs("agent-real-estate.yml").values()
    assert job["uses"] == "Kghaffari26/agents-core/.github/workflows/run-agent.yml@v0.3.1"
    # contents: write pushes data/ and the data branch; this agent opens no issues.
    assert job["permissions"] == {"contents": "write"}
    assert job["with"]["agent"] == "real_estate"
    assert "public-data" not in job["with"].get("cache_path", "")  # restored from the data branch


def test_evals_workflow_calls_run_evals_with_a_spend_cap_and_read_only_token():
    [job] = _jobs("evals.yml").values()
    assert job["uses"] == "Kghaffari26/agents-core/.github/workflows/run-evals.yml@v0.3.1"
    assert job["permissions"] == {"contents": "read"}
    assert float(job["with"]["max_usd"]) <= 1.0
    assert float(job["with"]["total_max_usd"]) <= 1.0  # one cap across all suites (v0.3.1)
    assert "agents-evals run" in job["with"]["eval_command"]


def test_listing_prep_worker_is_opt_in_read_only_and_keeps_its_secrets_server_side():
    [job] = _jobs("listing-prep-worker.yml").values()
    assert job["if"] == "${{ vars.DESK_WORKER_ENABLED == 'true' }}"
    workflow = yaml.safe_load((WORKFLOWS / "listing-prep-worker.yml").read_text())
    assert workflow["permissions"] == {"contents": "read"}
    env = job["steps"][-1]["env"]
    assert env["SUPABASE_SERVICE_ROLE_KEY"] == "${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}"
    # Photo findings plus at most two reports ($0.80 each, claimed only while the cap covers one).
    assert float(env["AGENTS_CORE_MAX_RUN_USD"]) <= 2.5
    # The site's build gets the public URL and anon key, never the service key.
    site = (WORKFLOWS / "dashboard.yml").read_text()
    assert "SUPABASE_SERVICE_ROLE_KEY" not in site
    assert "check:secrets" in site
