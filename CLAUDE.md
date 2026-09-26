# real-estate-agent

A single scheduled data agent (`real_estate`) built on the external
[`agents-core`](https://github.com/Kghaffari26/agents-core) framework (v0.1.0).
Full design: `docs/specs/SPEC_REAL_ESTATE.md` (and `docs/specs/BUILD_PLAN.md`
for how this fits a larger multi-agent plan). Current status against the spec,
including what's blocked and why: `STATUS.md`. `DECISIONS.md` logs judgment
calls made while working unattended — read it before assuming something here
was a mistake rather than a deliberate, documented choice.

## Architecture

```
real-estate-agent/
├── agents/real_estate/     # agent.py (the agents_core Agent: fetch/transform/analyze),
│                           # fetch_*.py, download.py (conditional GET on agents_core.http),
│                           # transform.py, compute.py, temperature.py, flags.py, movers.py,
│                           # analyze.py (facts, prompts, LLM + guards), templates.py
│                           # (fallback briefs + headline), schema.py, state.py, config.py, metrics.py
├── config/                 # metros.toml, real_estate.toml
├── scripts/                # verify_re_sources.py, build_metro_config.py, export_re_schema.py
├── schemas/                # real_estate.schema.json (index + metro detail), committed
├── data/                   # committed run state: costs.jsonl, guard_failures.jsonl,
│                           # real_estate/{state,briefs,acs_income}.json. gitignored: cache/
├── public-data/            # gitignored; the agents-core data-branch contract (see below)
├── evals/real_estate/      # offline eval suite (SPEC §11), no network/LLM calls
└── tests/                  # HTTP mocked (respx), fake Anthropic client, fixtures in tests/fixtures/
```

The framework is **`agents-core` v0.1.0**, installed from git by tag
(`pyproject.toml`; it requires Python 3.12). Its README/CLAUDE.md define the
agent contract. Don't modify or vendor it here; if it's missing something,
list it in `STATUS.md`'s "Needed from agents-core".

`pyproject.toml` registers `AGENT` (a `RealEstateAgent(agents_core.agent.Agent)`)
under the `agents_core.agents` entry point. agents-core's `agents-run` runs
**fetch (conditional GETs) → transform (pure Python: compute, flags,
temperature, movers, facts dicts) → analyze (briefs, assembly, size
limits)**, then validates against `schema.IndexOutput`, adds `meta`, and
publishes to `public-data/`: `latest.json`, `metros/<slug>.json`,
`history/YYYY-MM-DD.json`, `manifest-entry.json`, `costs-summary.json`,
`schema.json`. `.github/workflows/agent-real-estate.yml` calls agents-core's
reusable `run-agent.yml@v0.1.0`, which commits `data/` back to the branch and
force-pushes `public-data/` to the `data` branch.

## Rules

- **Numbers come from Python, never from an LLM.** Every YoY/MoM change,
  36-month high/low, percentile rank, the temperature z-score, every flag
  threshold, the headline, key stats and the affordability calculator are
  deterministic and unit-tested. The LLM only narrates the facts dicts
  `analyze.py` builds, and every LLM brief goes through
  `fields_guard(facts, ["text", "key_points"])` with the `templates.py`
  brief as the fallback (`narrative_source: "template"`).
- **Claude is only reached through `ctx.llm` (`agents_core.llm`).** Never
  import `anthropic` here or write a local LLM/guards module. Metro briefs:
  fast tier through the Batch API; national brief: smart tier, synchronous.
  Tiers and pricing come from agents-core's shipped `models.toml` (override
  in `config/models.toml` if needed). The key is `ANTHROPIC_API_KEY`, or
  `AGENTS_ANTHROPIC_API_KEY` where the former is reserved (cloud dev
  sessions); `MAX_RUN_USD` (`AGENTS_CORE_MAX_RUN_USD`) caps each run.
- **All HTTP goes through `ctx.http` (`agents_core.http.Http`)**: retries,
  per-host rate limits, a TTL cache for small responses. Large files (Redfin,
  Zillow) use `agents/real_estate/download.py`'s conditional GET on top of
  it. Never call `httpx` directly from a fetcher.
- **A brief regenerates only when its facts actually changed** (SHA-256 in
  `data/real_estate/state.json`; the briefs themselves are cached in
  `data/real_estate/briefs.json`, because CI has no `public-data/`). Metro
  facts exclude rate/affordability fields, and the metro prompt omits them,
  so a mortgage-rate move alone regenerates only the national brief. An
  unchanged second run makes zero LLM calls; keep it that way.
- **Optional sources degrade to `null`, they never fail the run**: Zillow,
  Census permits, ACS income and FRED catch their own exceptions and log a
  warning. agents-core's `RunMeta` has no `warnings` field, so warnings go to
  the log and to `state.json`'s `last_run`. Redfin and the LLM path (API or
  auth errors, `BudgetExceeded`) fail the run; an unusable single LLM
  response falls back to the template.
- **Published JSON stays small**: index ≤150KB, each metro file ≤40KB
  (`config/real_estate.toml`), enforced in `agent.py` (§10 trimming, then
  `PublishSizeError`). Check real output sizes when you grow the payload,
  not just tests.
- **The §6 JSON shapes are the site contract.** `schema.py` is exported to
  `schemas/real_estate.schema.json` by `scripts/export_re_schema.py`, and a
  test fails if the committed file is stale.
- **Keep published paths generic**: use `agents_core.settings.publish_dir()`
  / `data_dir()` (env-overridable), never a site path.
- Secrets come from environment variables only (`ANTHROPIC_API_KEY` /
  `AGENTS_ANTHROPIC_API_KEY`, `FRED_API_KEY`, `CENSUS_API_KEY`). Never
  commit them; `.env.example` lists what's expected.
- Respect source terms: attribute Redfin, Zillow, FRED, and the Census
  Bureau wherever the data is shown, and don't redistribute raw datasets.

## Commands

```bash
uv sync                                        # install (agents-core v0.1.0 from git)
uv run agents-run real_estate --dry-run        # fetch + compute, per-metro table, zero LLM calls, no publish
uv run agents-run real_estate                  # real run (LLM briefs), publishes to public-data/
uv run agents-run real_estate --force-briefs   # regenerate every brief regardless of hashes
uv run agents-run --list                       # show every registered agent
uv run pytest                                  # tests (HTTP and Anthropic both faked)
uv run ruff check .
uv run python -m evals.real_estate.run         # offline eval suite (SPEC §11)
uv run python scripts/verify_re_sources.py     # which data-source URLs are reachable
uv run python scripts/build_metro_config.py    # regenerate config/metros.toml (Redfin + Zillow + Gazetteer)
uv run python scripts/export_re_schema.py      # after any schema.py change
```

## Before making a change

1. Check `STATUS.md` first — it lists exactly what's done, what's
   blocked (and why), and what network sources are currently reachable
   from this environment. Don't rediscover a known blocker.
2. Check `DECISIONS.md` for prior judgment calls that might explain why
   something looks like it should be "fixed" but isn't.
3. Run `uv run pytest` and `uv run ruff check .` before and after; both
   must stay clean.
