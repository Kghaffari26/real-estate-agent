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
    # The daily caps come from repository variables, never hard-coded secrets.
    assert env["DESK_DAILY_USD_PER_TEAM"] == "${{ vars.DESK_DAILY_USD_PER_TEAM }}"
    assert env["DESK_DAILY_USD_GLOBAL"] == "${{ vars.DESK_DAILY_USD_GLOBAL }}"
    # The site's build gets the public URL and anon key, never the service key.
    site = (WORKFLOWS / "dashboard.yml").read_text()
    assert "SUPABASE_SERVICE_ROLE_KEY" not in site
    assert "check:secrets" in site


def test_the_live_report_eval_is_manual_capped_read_only_and_uploads_its_recordings():
    wf = yaml.safe_load((WORKFLOWS / "report-agent-eval.yml").read_text())
    on = wf[True]  # YAML 1.1 reads the key `on` as true
    assert set(on) == {"workflow_dispatch", "pull_request"} and on["pull_request"] == {"types": ["labeled"]}
    assert wf["permissions"] == {"contents": "read"}
    [job] = wf["jobs"].values()
    # A label run only for this repository's branches (fork runs get no secrets anyway).
    assert "live-eval" in job["if"] and "head.repo.full_name == github.repository" in job["if"]
    run = next(s for s in job["steps"] if "agents-evals run" in s.get("run", ""))
    assert "evals.listing_prep.suites:REPORT_AGENT" in run["run"] and "--max-usd 2.50" in run["run"]
    assert run["env"]["ANTHROPIC_API_KEY"] == "${{ secrets.ANTHROPIC_API_KEY }}"
    assert run["env"]["LP_SAVE_TRAJECTORIES"] == "evals/listing_prep/trajectories"
    assert set(run["env"]) == {"ANTHROPIC_API_KEY", "LP_SAVE_TRAJECTORIES", "AGENTS_CORE_DATA_DIR"}  # no other secrets
    upload = next(s for s in job["steps"] if s.get("uses", "").startswith("actions/upload-artifact@"))
    assert upload["if"] == "always()" and "evals/listing_prep/trajectories/" in upload["with"]["path"]
