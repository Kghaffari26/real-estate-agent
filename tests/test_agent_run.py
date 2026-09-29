"""End to end through agents-core's own runner, offline: mocked Redfin downloads
(respx) and a fake Anthropic client. Covers the agents-core data-branch contract
(latest.json, metros/, history/, manifest-entry.json, costs-summary.json,
schema.json, trace.json), the §6 shapes, and SPEC §13's "an immediate second run
makes zero LLM calls": briefs and investigations are reused from the previous
published output (restored from the data branch in CI) when their facts hashes in
data/real_estate/state.json match.
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
from agents.real_estate.schema import IndexOutput, MetroDetailOutput, TimelineOutput
from tests import redfin_dc_fixtures as dc

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


EXPLANATION = (
    "Prices kept rising at a steady pace. Supply stayed tight relative to sales. Peers in the"
    " region moved the same way. The data can't isolate a single local cause."
)


class FakeClient:
    """Answers every metro brief in the batch and the national brief with text that
    has no numbers (so it always passes the guard); drives the investigator loop
    (one get_metro_series call, then finish); counts every request."""

    def __init__(self) -> None:
        self.requests = 0
        self.loop_requests = 0
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

        def create_message(**params):  # the agent loop (LLM.converse)
            self.requests += 1
            self.loop_requests += 1
            messages = params["messages"]
            if len(messages) == 1:
                content = messages[0]["content"]  # the cache breakpoint makes it a block list
                text = content if isinstance(content, str) else content[0]["text"]
                slug = text.split("slug `")[1].split("`")[0]
                block = SimpleNamespace(
                    type="tool_use",
                    id=f"t{self.loop_requests}",
                    name="get_metro_series",
                    input={"slug": slug, "metrics": ["median_sale_price", "inventory"], "months": 13},
                )
            else:
                block = SimpleNamespace(
                    type="tool_use",
                    id=f"t{self.loop_requests}",
                    name="finish",
                    input={"explanation": EXPLANATION, "cited_metrics": ["median_sale_price", "inventory"]},
                )
            return SimpleNamespace(content=[block], usage=usage, stop_reason="tool_use")

        self.messages = SimpleNamespace(
            create=create_message,
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


def _dc_files() -> dict[str, bytes]:
    months = _month_ends(26)
    metros = [("Alpha, TX metro area", "10001", "Metro", 400000), ("Beta, TX metro area", "10002", "Metro", 300000)]
    return {
        fetch_redfin.METRO_URL: dc.housing_csv([(n, rid, t, dc.default_values(p)) for n, rid, t, p in metros], months),
        fetch_redfin.PRICE_DROPS_METRO_URL: dc.price_drops_csv(
            [(n, t, lambda i: 8.0 + 0.2 * i) for n, _, t, _ in metros], months
        ),
        fetch_redfin.NATIONAL_URL: dc.housing_csv([("National", None, "Country", dc.default_values(420000))], months),
        fetch_redfin.PRICE_DROPS_NATIONAL_URL: dc.price_drops_csv([("National", "Country", 9.0)], months),
    }


def _mock_redfin(legacy: bool = False) -> None:
    """The Data Center CSVs (default), or, with legacy=True, only the frozen legacy TSVs
    while the Data Center files 404 (the fallback path)."""
    if legacy:
        for url in (fetch_redfin.METRO_URL, fetch_redfin.PRICE_DROPS_METRO_URL, fetch_redfin.NATIONAL_URL, fetch_redfin.PRICE_DROPS_NATIONAL_URL):
            respx.get(url).mock(return_value=httpx.Response(404))
        files = {
            fetch_redfin.LEGACY_METRO_URL: _tsv_gz("metro", [("Alpha, TX metro area", 400000), ("Beta, TX metro area", 300000)]),
            fetch_redfin.LEGACY_NATIONAL_URL: _tsv_gz("national", [("National", 420000)]),
        }
    else:
        files = _dc_files()
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
    # 2 metro briefs in one batch + the national brief + a 2-step investigation
    assert client.requests == 5 and client.loop_requests == 2

    pub = workdir / "public-data"
    latest = json.loads((pub / "latest.json").read_text())
    index = IndexOutput.model_validate(latest)
    assert index.meta.agent == "real_estate"
    assert index.meta.cost_usd > 0
    assert index.meta.model_usage.fast.input_tokens == 2000  # 2 batch items + 2 loop steps
    assert index.meta.warnings == ["FRED fetch failed: FRED_API_KEY is not set"]
    assert index.national.brief.narrative_source == "llm"
    assert index.national.brief.model == "claude-sonnet-5"
    assert [m.slug for m in index.metros] == ["alpha-tx", "beta-tx"]
    assert index.meta.schema_version == "1.3.0"
    # §6.4 timelines: five metrics, monthly from 2012-01 to the latest month; the
    # fixture's 26 months are filled, earlier months are null.
    assert [t.metric for t in index.timelines] == ["median_sale_price", "inventory", "median_dom", "price_drops", "months_of_supply"]
    ref = index.timelines[0]
    assert (ref.path, ref.start, ref.end) == ("timeline/median_sale_price.json", date(2012, 1, 31), index.data_through)
    timeline = TimelineOutput.model_validate_json((pub / ref.path).read_text())
    assert len(timeline.dates) == ref.months and timeline.dates[-1] == index.data_through
    assert set(timeline.metros) == {"alpha-tx", "beta-tx"}
    alpha_tl = timeline.metros["alpha-tx"]
    assert alpha_tl[0] is None and sum(v is not None for v in alpha_tl) == 26
    # §6.3 metros[].spark: 24 month-end median prices, whole dollars, latest last
    alpha = index.metros[0]
    assert len(alpha.spark) == 24 and alpha.spark[-1] == round(alpha.latest["median_sale_price"].value)
    # No new major flag in the fixture data: the top mover is investigated.
    [summary] = index.investigations
    assert summary.trigger == "top_mover" and summary.narrative_source == "llm"
    assert summary.summary == "Prices kept rising at a steady pace."
    for slug in ("alpha-tx", "beta-tx"):
        detail = MetroDetailOutput.model_validate_json((pub / "metros" / f"{slug}.json").read_text())
        assert detail.brief.narrative_source == "llm"
        assert detail.brief.model == "claude-haiku-4-5-20251001"
        assert detail.brief.reused is False
        assert len(detail.series["dates"]) == 36
        # The timeline's recent months are the metro file's levels (rounded to whole dollars).
        tl_prices = timeline.metros[slug]
        assert [None if v is None else round(v) for v in detail.series["median_sale_price"][-24:]] == tl_prices[-24:]
        assert detail.latest["median_dom"].delta_format == "count_signed"
        assert detail.latest["months_of_supply"].delta_format == "decimal1"
    inv = MetroDetailOutput.model_validate_json((pub / "metros" / f"{summary.slug}.json").read_text()).investigation
    assert inv is not None and inv.explanation == EXPLANATION
    assert inv.tools_called == ["get_metro_series"]  # finish is the result, not a tool call
    assert inv.stop_reason == "finished" and inv.steps == 2 and inv.cost_usd > 0
    assert inv.cited_metrics == ["median_sale_price", "inventory"]
    assert len(list((pub / "history").glob("*.json"))) == 1
    manifest = json.loads((pub / "manifest-entry.json").read_text())
    assert manifest["id"] == "real_estate" and manifest["route"] == "/real-estate"
    assert manifest["items_count"] == 2 and manifest["expected_interval_hours"] == 168
    assert manifest["trace_summary"]["steps"] == 2 and manifest["trace_summary"]["tool_calls"] == 1
    assert json.loads((pub / "costs-summary.json").read_text())["runs"] == 1
    assert json.loads((pub / "schema.json").read_text())["title"] == "IndexOutput"
    # Tracing (agents_core.tracing): every phase plus this agent's own spans.
    trace = json.loads((pub / "trace.json").read_text())
    names = {(sp["kind"], sp["name"]) for sp in trace["spans"]}
    for expected in [
        ("phase", "fetch"), ("phase", "analyze"), ("custom", "fetch:redfin"), ("custom", "metro_briefs"),
        ("custom", "national_brief"), ("custom", "investigations"), ("agent_loop", f"investigate:{summary.slug}"),
        ("tool_call", "get_metro_series"),
    ]:  # fmt: skip
        assert expected in names, expected
    assert (pub / "trace.schema.json").exists()
    # Run state that run-agent.yml commits back to main: hashes only, no brief cache.
    assert (workdir / "data" / "costs.jsonl").exists()
    state = json.loads((workdir / "data" / "real_estate" / "state.json").read_text())
    assert set(state["brief_hashes"]) == {"alpha-tx", "beta-tx", "national"}
    assert set(state["investigation_hashes"]) == {summary.slug}
    assert not (workdir / "data" / "real_estate" / "briefs.json").exists()

    # Second run on the restored publish dir: everything is reused, zero LLM calls.
    second = FakeClient()
    assert _run(workdir, second) == 0
    assert second.requests == 0
    latest2 = IndexOutput.model_validate_json((pub / "latest.json").read_text())
    assert latest2.meta.data_changed is False
    assert latest2.meta.cost_usd == 0
    assert latest2.national.brief.reused is True
    assert latest2.investigations == index.investigations
    detail2 = MetroDetailOutput.model_validate_json((pub / "metros" / "alpha-tx.json").read_text())
    assert detail2.brief.reused is True
    assert detail2.brief.text == "Prices were little changed and the market stayed balanced."
    inv2 = MetroDetailOutput.model_validate_json((pub / "metros" / f"{summary.slug}.json").read_text()).investigation
    assert inv2 is not None and inv2.reused is True and inv2.explanation == EXPLANATION

    # --force-briefs regenerates everything
    third = FakeClient()
    assert _run(workdir, third, "--force-briefs") == 0
    assert third.requests == 5

    # Without the previous output (a local checkout with no data branch), the hashes
    # alone can't reuse anything: every narrative is regenerated.
    import shutil

    shutil.rmtree(pub)
    fourth = FakeClient()
    assert _run(workdir, fourth) == 0
    assert fourth.requests == 5


@respx.mock
def test_without_an_api_key_the_run_publishes_templates_with_a_warning(workdir, monkeypatch):
    """agents-hub: no Anthropic key must not crash the run. Every narrative falls back
    to the template, status is ok, meta.warnings says why, and the hashes aren't
    stored, so the first run with a key regenerates them."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("AGENTS_ANTHROPIC_API_KEY", raising=False)
    _mock_redfin()
    with Http(cache_dir=workdir / ".cache" / "http") as http:
        assert runner.run(AGENT, http=http) == 0
    pub = workdir / "public-data"
    index = IndexOutput.model_validate_json((pub / "latest.json").read_text())
    assert index.meta.status == "ok"
    assert index.meta.cost_usd == 0
    assert any("No Anthropic API key" in w for w in index.meta.warnings)
    assert index.national.brief.narrative_source == "template"
    [summary] = index.investigations
    assert summary.narrative_source == "template" and summary.stop_reason == "not_run"
    detail = MetroDetailOutput.model_validate_json((pub / "metros" / f"{summary.slug}.json").read_text())
    assert detail.brief.narrative_source == "template"
    assert detail.investigation is not None
    assert 4 <= len(detail.investigation.explanation.split(". ")) <= 6
    state = json.loads((workdir / "data" / "real_estate" / "state.json").read_text())
    assert state["brief_hashes"] == {} and state["investigation_hashes"] == {}

    # A later run with a key regenerates every narrative with the LLM.
    client = FakeClient()
    assert _run(workdir, client) == 0
    assert client.requests == 5


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
    for url in (
        fetch_redfin.METRO_URL, fetch_redfin.PRICE_DROPS_METRO_URL, fetch_redfin.NATIONAL_URL,
        fetch_redfin.PRICE_DROPS_NATIONAL_URL, fetch_redfin.LEGACY_METRO_URL, fetch_redfin.LEGACY_NATIONAL_URL,
    ):  # fmt: skip
        respx.get(url).mock(return_value=httpx.Response(404))
    assert _run(workdir, FakeClient()) == 1
    manifest = json.loads((workdir / "public-data" / "manifest-entry.json").read_text())
    assert manifest["status"] == "failed"
    assert not (workdir / "public-data" / "latest.json").exists()


@respx.mock
def test_stale_redfin_data_is_published_with_a_warning(workdir):
    """2026-09: Redfin's public S3 export stopped at May 2026. The run still publishes
    (the data is valid), but meta.warnings says the latest month is older than usual."""
    settings = workdir / "config" / "real_estate.toml"
    settings.write_text(settings.read_text().replace("[settings]", "[settings]\nredfin_stale_after_days = 0", 1))
    _mock_redfin()
    assert _run(workdir, FakeClient()) == 0
    index = IndexOutput.model_validate(json.loads((workdir / "public-data" / "latest.json").read_text()))
    assert index.meta.status == "ok"
    assert any(w.startswith("Redfin data runs through ") and "days old" in w for w in index.meta.warnings)


@respx.mock
def test_data_center_outage_falls_back_to_the_legacy_export_with_a_warning(workdir):
    _mock_redfin(legacy=True)
    assert _run(workdir, FakeClient()) == 0
    index = IndexOutput.model_validate(json.loads((workdir / "public-data" / "latest.json").read_text()))
    assert any("used the legacy market-tracker export" in w for w in index.meta.warnings)
    assert [s.name for s in index.meta.sources][:2] == ["Redfin metro market tracker (legacy)", "Redfin national market tracker (legacy)"]
    assert [m.slug for m in index.metros] == ["alpha-tx", "beta-tx"]


@respx.mock
def test_data_center_run_converts_percents_to_ratios(workdir):
    _mock_redfin()
    assert _run(workdir, FakeClient()) == 0
    index = IndexOutput.model_validate(json.loads((workdir / "public-data" / "latest.json").read_text()))
    alpha = next(m for m in index.metros if m.slug == "alpha-tx")
    assert alpha.latest["avg_sale_to_list"].value == pytest.approx(0.98)
    assert alpha.latest["sold_above_list"].value == pytest.approx(0.30)
    assert alpha.latest["off_market_in_two_weeks"].value == pytest.approx(0.20)
    # Price drops joined by name: 8.0% + 0.2 per month → ratio; YoY computed by us in pp.
    assert alpha.latest["price_drops"].value == pytest.approx((8.0 + 0.2 * 25) / 100)
    assert alpha.latest["price_drops"].yoy == pytest.approx(0.024)
    assert index.meta.sources[0].name == "Redfin Data Center: housing market, metros"
