"""End to end through agents-core's own runner, offline: mocked Redfin downloads
(respx) and a fake Anthropic client. Covers the agents-core data-branch contract
(latest.json, metros/, history/, manifest-entry.json, costs-summary.json,
schema.json), the §6 shapes, and SPEC §13's "an immediate second run makes zero
LLM calls" via the brief cache in data/real_estate/.
"""

from __future__ import annotations

import gzip
import json
from datetime import date, timedelta
from types import SimpleNamespace

import httpx
import pytest
import respx
from agents_core import runner
from agents_core.http import Http

from agents.real_estate import fetch_redfin
from agents.real_estate.agent import AGENT
from agents.real_estate.schema import IndexOutput, MetroDetailOutput

COLUMNS = [
    "PERIOD_BEGIN", "PERIOD_END", "REGION_TYPE", "REGION", "STATE_CODE", "PROPERTY_TYPE", "TABLE_ID",
    "PERIOD_DURATION", "IS_SEASONALLY_ADJUSTED", "MEDIAN_SALE_PRICE", "HOMES_SOLD", "NEW_LISTINGS",
    "INVENTORY", "MONTHS_OF_SUPPLY", "MEDIAN_DOM", "AVG_SALE_TO_LIST", "SOLD_ABOVE_LIST", "PRICE_DROPS",
    "OFF_MARKET_IN_TWO_WEEKS", "LAST_UPDATED", "PARENT_METRO_REGION", "PARENT_METRO_REGION_METRO_CODE",
]  # fmt: skip


def _month_ends(n: int) -> list[date]:
    end = date.today().replace(day=1) - timedelta(days=1)  # last month's end
    out = []
    for _ in range(n):
        out.append(end)
        end = end.replace(day=1) - timedelta(days=1)
    return sorted(out)


def _tsv_gz(region_type: str, regions: list[tuple[str, float]]) -> bytes:
    lines = ["\t".join(COLUMNS)]
    for region, base_price in regions:
        for i, end in enumerate(_month_ends(26)):
            price = base_price * (1 + 0.004 * i)
            row = [
                end.replace(day=1).isoformat(), end.isoformat(), region_type, region, "TX", "All Residential",
                "1", "30", "false", f"{price:.0f}", str(1000 + i), "1500", str(4000 + 40 * i), "3.2",
                str(30 + i % 5), "0.98", "0.3", f"{0.08 + 0.002 * i:.3f}", "0.2", "2026-09-01 00:00:00",
                region.replace(" metro area", ""), "12345",
            ]  # fmt: skip
            lines.append("\t".join(row))
    return gzip.compress(("\n".join(lines) + "\n").encode())


METROS_TOML = """
[[metro]]
slug = "alpha-tx"
name = "Alpha, TX"
redfin_region = "Alpha, TX metro area"
cbsa = "10001"
lat = 30.0
lon = -97.0

[[metro]]
slug = "beta-tx"
name = "Beta, TX"
redfin_region = "Beta, TX metro area"
cbsa = "10002"
lat = 31.0
lon = -96.0
"""

SETTINGS_TOML = """
[settings]
use_permits = false
use_acs_income = false
batch_poll_timeout_min = 1
max_index_kb = 150
max_metro_kb = 40
"""


class FakeClient:
    """Answers every metro brief in the batch and the national brief with text that
    has no numbers (so it always passes the guard); counts every request."""

    def __init__(self) -> None:
        self.requests = 0
        brief = {"text": "Prices were little changed and the market stayed balanced.", "key_points": ["Steady"]}
        usage = SimpleNamespace(input_tokens=500, output_tokens=50, cache_creation_input_tokens=0, cache_read_input_tokens=0)
        message = SimpleNamespace(
            content=[SimpleNamespace(type="text", text=json.dumps(brief))], usage=usage, stop_reason="end_turn"
        )
        created: list = []

        def create(requests):
            self.requests += len(requests)
            created[:] = requests
            return SimpleNamespace(id="b1")

        def results(batch_id):
            for r in created:
                yield SimpleNamespace(custom_id=r["custom_id"], result=SimpleNamespace(type="succeeded", message=message))

        def parse(*, output_format, **params):
            self.requests += 1
            return SimpleNamespace(**vars(message), parsed_output=output_format.model_validate(brief))

        self.messages = SimpleNamespace(
            parse=parse,
            batches=SimpleNamespace(
                create=create,
                retrieve=lambda batch_id: SimpleNamespace(processing_status="ended"),
                cancel=lambda batch_id: None,
                results=results,
            ),
        )


@pytest.fixture
def workdir(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    for var in ("FRED_API_KEY", "AGENTS_CORE_PUBLISH_DIR", "AGENTS_CORE_DATA_DIR", "AGENTS_CORE_COSTS_PATH"):
        monkeypatch.delenv(var, raising=False)
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "metros.toml").write_text(METROS_TOML)
    (tmp_path / "config" / "real_estate.toml").write_text(SETTINGS_TOML)
    return tmp_path


def _mock_redfin() -> None:
    files = {
        fetch_redfin.METRO_URL: _tsv_gz("metro", [("Alpha, TX metro area", 400000), ("Beta, TX metro area", 300000)]),
        fetch_redfin.NATIONAL_URL: _tsv_gz("national", [("National", 420000)]),
    }
    for url, body in files.items():

        def respond(request, body=body):
            if request.headers.get("If-None-Match") == '"v1"':
                return httpx.Response(304)
            return httpx.Response(200, content=body, headers={"ETag": '"v1"'})

        respx.get(url).mock(side_effect=respond)


def _run(workdir, client: FakeClient, *extra: str) -> int:
    with Http(cache_dir=workdir / ".cache" / "http") as http:
        return runner.run(AGENT, http=http, llm_client=client, extra_args=list(extra))


@respx.mock
def test_real_run_publishes_the_data_branch_contract_then_reuses_briefs(workdir):
    _mock_redfin()
    client = FakeClient()
    assert _run(workdir, client) == 0
    assert client.requests == 3  # 2 metro briefs in one batch + the national brief

    pub = workdir / "public-data"
    latest = json.loads((pub / "latest.json").read_text())
    index = IndexOutput.model_validate(latest)
    assert index.meta.agent == "real_estate"
    assert index.meta.cost_usd > 0
    assert index.meta.model_usage.fast.input_tokens == 1000
    assert index.national.brief.narrative_source == "llm"
    assert index.national.brief.model == "claude-sonnet-5"
    assert [m.slug for m in index.metros] == ["alpha-tx", "beta-tx"]
    for slug in ("alpha-tx", "beta-tx"):
        detail = MetroDetailOutput.model_validate_json((pub / "metros" / f"{slug}.json").read_text())
        assert detail.brief.narrative_source == "llm"
        assert detail.brief.model == "claude-haiku-4-5-20251001"
        assert detail.brief.reused is False
        assert len(detail.series["dates"]) == 36
    assert len(list((pub / "history").glob("*.json"))) == 1
    manifest = json.loads((pub / "manifest-entry.json").read_text())
    assert manifest["id"] == "real_estate" and manifest["route"] == "/real-estate"
    assert manifest["items_count"] == 2 and manifest["expected_interval_hours"] == 168
    assert json.loads((pub / "costs-summary.json").read_text())["runs"] == 1
    assert json.loads((pub / "schema.json").read_text())["title"] == "IndexOutput"
    # Run state that run-agent.yml commits back to main
    assert (workdir / "data" / "costs.jsonl").exists()
    assert set(json.loads((workdir / "data" / "real_estate" / "briefs.json").read_text())) == {
        "alpha-tx", "beta-tx", "national"
    }  # fmt: skip

    # A fresh checkout has no public-data/ (it lives on the data branch): the
    # brief cache in data/real_estate/ alone must be enough to reuse every brief.
    import shutil

    shutil.rmtree(pub)
    second = FakeClient()
    assert _run(workdir, second) == 0
    assert second.requests == 0
    latest2 = IndexOutput.model_validate_json((workdir / "public-data" / "latest.json").read_text())
    assert latest2.meta.data_changed is False
    assert latest2.meta.cost_usd == 0
    assert latest2.national.brief.reused is True
    detail2 = MetroDetailOutput.model_validate_json((workdir / "public-data" / "metros" / "alpha-tx.json").read_text())
    assert detail2.brief.reused is True
    assert detail2.brief.text == "Prices were little changed and the market stayed balanced."

    # --force-briefs regenerates everything
    third = FakeClient()
    assert _run(workdir, third, "--force-briefs") == 0
    assert third.requests == 3


@respx.mock
def test_dry_run_makes_no_llm_calls_and_publishes_nothing(workdir, capsys):
    _mock_redfin()
    client = FakeClient()
    with Http(cache_dir=workdir / ".cache" / "http") as http:
        assert runner.run(AGENT, dry_run=True, http=http, llm_client=client) == 0
    assert client.requests == 0
    assert not (workdir / "public-data").exists()
    assert not (workdir / "data" / "real_estate" / "state.json").exists()


@respx.mock
def test_redfin_failure_fails_the_run_and_keeps_previous_latest(workdir):
    respx.get(fetch_redfin.METRO_URL).mock(return_value=httpx.Response(404))
    respx.get(fetch_redfin.NATIONAL_URL).mock(return_value=httpx.Response(404))
    assert _run(workdir, FakeClient()) == 1
    manifest = json.loads((workdir / "public-data" / "manifest-entry.json").read_text())
    assert manifest["status"] == "failed"
    assert not (workdir / "public-data" / "latest.json").exists()
