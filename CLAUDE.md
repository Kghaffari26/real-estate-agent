# real-estate-agent

A single scheduled data agent (`real_estate`) built on the external
[`agents-core`](https://github.com/Kghaffari26/agents-core) framework (v0.3.2, pinned by
commit SHA `9e4f342` until the v0.3.2 tag exists).
Full design: `docs/specs/SPEC_REAL_ESTATE.md` (§6.3 covers the investigator
and the other additive fields; `docs/specs/BUILD_PLAN.md` shows how this fits a
larger multi-agent plan). Current status against the spec, including what's
blocked and why: `STATUS.md`. Real incidents and what caught them:
`docs/case-studies.md`. `DECISIONS.md` logs judgment calls made while working
unattended — read it before assuming something here was a mistake rather than a
deliberate, documented choice.

## Architecture

```
real-estate-agent/
├── agents/real_estate/     # agent.py (the agents_core Agent: fetch/transform/analyze),
│                           # fetch_*.py, transform.py, compute.py, temperature.py, flags.py
│                           # (flags + alert groups), movers.py, analyze.py (facts, prompts,
│                           # LLM + guards), investigate.py (the metro investigator agent loop),
│                           # templates.py (fallback briefs + headline), schema.py, state.py
│                           # (hashes + previous published output), config.py, metrics.py
├── config/                 # metros.toml, real_estate.toml
├── scripts/                # verify_re_sources.py, build_metro_config.py, export_re_schema.py,
│                           # build_investigator_fixtures.py
├── schemas/                # real_estate.schema.json (index + metro detail), committed
├── data/                   # committed run state: costs.jsonl, eval_costs.jsonl, guard_failures.jsonl,
│                           # real_estate/{state,acs_income}.json. gitignored: cache/
├── public-data/            # gitignored; the agents-core data-branch contract (see below)
├── evals/                  # history.jsonl + results/ (agents_core.evals, committed);
│                           # real_estate/: suites.py (3 suites), checks.py, fixtures.py,
│                           # investigator_{world.json,cases.jsonl}, trajectories/ (recorded loops)
├── dashboard/              # "Metro Pulse" v2 web app (Vite + React + TS, MapLibre + deck.gl, three.js), see
│                           # dashboard/README.md; sample-data/ = a committed real run; types
│                           # generated from schemas/; brand in src/config/brand.ts
├── docs/                   # specs/, case-studies.md, screenshots/ (dashboard, from Playwright)
└── tests/                  # HTTP mocked (respx), fake or replayed Anthropic client, fixtures in tests/fixtures/
```

The framework is **`agents-core` v0.3.2**, installed from git by commit
(`rev = "9e4f342a06b4e74bb27d73cf759e931033fa97bf"` in `pyproject.toml`, because the
`v0.3.2` tag doesn't exist yet; switch to `tag = "v0.3.2"` once a human creates it;
it requires Python 3.12). Its README/CHANGELOG define the
agent contract. Don't modify or vendor it here; if it's missing something,
list it in `STATUS.md`'s "Needed from agents-core".

`pyproject.toml` registers `AGENT` (a `RealEstateAgent(agents_core.agent.Agent)`)
under the `agents_core.agents` entry point. agents-core's `agents-run` runs
**fetch (conditional GETs) → transform (pure Python: compute, flags,
temperature, movers, facts dicts, the investigator's `World` and targets) →
analyze (briefs, investigations, assembly, size limits)**, then validates
against `schema.IndexOutput`, adds `meta` (including `meta.warnings`), and
publishes to `public-data/`: `latest.json`, `metros/<slug>.json`,
`history/YYYY-MM-DD.json`, `manifest-entry.json` (with `trace_summary`),
`costs-summary.json`, `schema.json`, `trace.json`, `trace.schema.json`.

`.github/workflows/agent-real-estate.yml` calls agents-core's reusable
`run-agent.yml` at the same commit. That workflow restores the `data` branch into
`public-data/`, runs the agent, commits `data/` back to the branch and
force-pushes `public-data/` to the `data` branch. `.github/workflows/evals.yml`
calls `run-evals.yml` at that commit on pull requests. **The reusable workflows declare
no permissions**; each calling job must grant exactly what it needs:
- `contents: write` for the agent;
- `issues: write` only if the agent ever calls `ctx.alert` (it doesn't);
- `contents: read` for evals.

## Rules

- **Numbers come from Python, never from an LLM.** Every YoY/MoM change,
  36-month high/low, percentile rank, the temperature z-score, every flag
  threshold, the headline, key stats and the affordability calculator are
  deterministic and unit-tested. The LLM only narrates the facts dicts
  `analyze.py` builds, and every LLM brief goes through
  `fields_guard(facts, ["text", "key_points"], no_multiples=True)` (no
  multiples or ratios the model computed, agents-core v0.3.2) with the `templates.py`
  brief as the fallback (`narrative_source: "template"`).
- **The investigator gets no looser rules.**
  - Its tools only serve numbers Python computed, in the facts dicts' units.
  - Its `finish` explanation is number-guarded against everything the tools
    returned in that run, with `no_multiples=True`.
  - `finish` also enforces 4–6 sentences, known metric keys and no computed
    multiples or ratios (agents-core's `guards.find_derived`, so the model fixes
    them in-step without spending the guard's one retry).
  - Its fallback is `investigate.template_investigation`.
  - Bump `investigate.PROMPT_VERSION` whenever you change its prompt, tools or
    guards.
- **Claude is only reached through `ctx.llm` (`agents_core.llm`).** Never
  import `anthropic` here or write a local LLM/guards/loop module.
  - Metro briefs: fast tier through the Batch API.
  - National brief: smart tier, synchronous.
  - Investigator: `agents_core.agent_loop.AgentLoop`, fast tier, 8 steps and
    $0.05 per investigation (`investigate.BUDGET`).

  Tiers and pricing come from agents-core's shipped `models.toml` (override in
  `config/models.toml` if needed). The key is `ANTHROPIC_API_KEY`, or
  `AGENTS_ANTHROPIC_API_KEY` where the former is reserved (cloud dev sessions);
  `MAX_RUN_USD` (`AGENTS_CORE_MAX_RUN_USD`) caps each run.
- **A missing key is not an error.** When `agent.llm_available()` is false:
  - every new narrative is its template;
  - the run publishes `status: ok` with a warning;
  - the hashes aren't stored, so a later keyed run regenerates them.
- **Redfin comes from the relaunched Data Center** (`redfin_data_center/…/monthly/*.csv`,
  spec §3.1): percents → ratios, price drops joined by region name, legacy
  `redfin_market_tracker/` only as an all-or-nothing fallback (never mix the two:
  different methodology). `scripts/verify_re_sources.py --names` checks the name join live.
- **All HTTP goes through `ctx.http` (`agents_core.http.Http`)**: retries,
  per-host rate limits, a 2xx-only TTL cache for small responses. Large files
  (Redfin, Zillow) use `ctx.http.download` (streaming conditional GET). Never
  call `httpx` directly from a fetcher.
- **A brief or investigation regenerates only when its facts actually
  changed.**
  - The hash is SHA-256, stored in `<data dir>/real_estate/state.json`.
  - The text is reused from the previous published output (`state.Previous`:
    the publish dir, which run-agent.yml restores from the `data` branch).
  - Metro facts exclude rate/affordability fields, and the metro prompt omits
    them, so a mortgage-rate move alone regenerates only the national brief,
    plus the investigations, which hash the whole investigator snapshot and
    may cite rates.
  - An unchanged second run makes zero LLM calls; keep it that way.
- **Optional sources degrade to `null`, they never fail the run.**
  - Zillow, Census permits, ACS income and FRED catch their own exceptions and
    call `ctx.warn(...)`, which publishes to `meta.warnings`.
  - Redfin failures fail the run, and so do API/auth errors on the LLM path.
  - An unusable single LLM response falls back to the template.
  - An investigation that stops early (budget, refusal, no `finish`) publishes
    its template with a warning.
- **Published JSON stays small**: index ≤150KB, each metro file ≤40KB
  (`config/real_estate.toml`), enforced in `agent.py` (`fit_index`: §10
  trimming, then `PublishSizeError`). Check real output sizes when you grow
  the payload, not just tests. The index was 147.5 KiB until the `metros[].latest`
  summaries were cut to §6.1's `{value, yoy}`; it's ~85 KB now
  (`docs/case-studies.md` #1).
- **The §6 JSON shapes are the site contract.**
  - Only add fields, always with defaults, and document them in a spec §6.x
    section. Bump `schema_version`'s minor version.
  - Every `format`/`delta_format` must be an agents-core `StatFormat`.
  - `schema.py` is exported to `schemas/real_estate.schema.json` by
    `scripts/export_re_schema.py`, and a test fails if the committed file is
    stale.
- **Evals gate prompt and agent changes.**
  - `evals/real_estate/suites.py` (`agents_core.evals`) appends to the
    committed `evals/history.jsonl`.
  - After changing a prompt, tool or guard, re-run the affected suite and
    commit its history line.
  - Re-record the investigator trajectories
    (`RE_SAVE_TRAJECTORIES=evals/real_estate/trajectories`) so the replay tests
    match.
- **The dashboard follows the contract, never the other way round.**
  - After any `schema.py` change: `scripts/export_re_schema.py`, then
    `cd dashboard && npm run gen:schema` (a dashboard test and CI fail if stale).
  - `dashboard/` never computes a number the agent should own; it formats published
    values and runs the calculator (same formula, shared vectors).
  - Styling lives only in `dashboard/src/styles/atlas.css` (v2 tokens), `tokens.css` + the Tailwind theme;
    data/logic in `data/`, `lib/`, `viewmodels/`; components are presentational.
  - Chart colors have jobs (categorical/diverging/sequential/status); re-validate
    with the dataviz palette validator if you change a step. No dual y-axes.
  - Keep `npm run check:bundle` (initial JS ≤ 300 KB gz) and `npm run e2e` (axe in
    both themes, 360 px, low tier) green; MapLibre, deck.gl and three.js stay lazy.
  - `npm run lighthouse` keeps accessibility at 100 on Arrival and Explore (CI enforces it);
    `npm run visual` compares every route against local baselines before a design gate.
  - `.github/workflows/dashboard.yml` grants only `contents: read`, `pages: write`,
    `id-token: write`.
- **Keep published paths generic**: use `agents_core.settings.publish_dir()`
  / `data_dir()` (env-overridable), never a site path.
- Secrets come from environment variables only (`ANTHROPIC_API_KEY` /
  `AGENTS_ANTHROPIC_API_KEY`, `FRED_API_KEY`, `CENSUS_API_KEY`). Never
  commit them; `.env.example` lists what's expected.
- Respect source terms: attribute Redfin, Zillow, FRED, and the Census
  Bureau wherever the data is shown, and don't redistribute raw datasets.

## Commands

```bash
uv sync                                        # install (agents-core v0.3.2 from git, by commit)
uv run agents-run real_estate --dry-run        # fetch + compute, per-metro table + investigation targets, zero LLM calls
uv run agents-run real_estate                  # real run (briefs + investigations), publishes to public-data/
uv run agents-run real_estate --force-briefs   # regenerate every brief and investigation regardless of hashes
uv run agents-run --list                       # show every registered agent
uv run pytest                                  # tests (HTTP faked, Anthropic faked or replayed)
uv run ruff check .
uv run python -m evals.real_estate.run         # the free template eval suite (SPEC §11)
uv run agents-evals run evals.listing_prep.suites:TEMPLATE_REPORTS  # Listing Prep report fallback (free)
LP_SAVE_TRAJECTORIES=evals/listing_prep/trajectories uv run agents-evals run evals.listing_prep.suites:REPORT_AGENT --max-usd 2.50  # ~$2 (or report-agent-eval.yml)
uv run agents-evals run evals.real_estate.suites:LLM_BRIEFS evals.real_estate.suites:INVESTIGATOR --max-usd 0.30  # ~$0.16
uv run agents-evals compare --threshold 0.10   # score deltas vs the previous history line
uv run python scripts/build_investigator_fixtures.py  # re-snapshot the investigator eval world (no LLM)
uv run python scripts/verify_re_sources.py     # which data-source URLs are reachable
uv run python scripts/build_metro_config.py    # regenerate config/metros.toml (Redfin + Zillow + Gazetteer)
uv run python scripts/export_re_schema.py      # after any schema.py change
uv run python scripts/build_county_centroids.py  # regenerate config/county_centroids.csv (§6.7) after metros.toml changes
uv run python scripts/fix_division_coords.py     # place metro divisions at their own counties (after build_metro_config.py)
uv run python scripts/build_region_geometry.py   # regenerate config/regions/*.geo.json (§6.8) after regions.toml changes
uv run python -m agents.listing_prep.worker      # the Desk's private worker (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
uv run python scripts/backtest_valuation.py closed_sales.csv  # the comp engine's coverage/error by price band
cd dashboard && npm ci && npm run fetch-data && npm run dev   # dashboard (see dashboard/README.md)
cd dashboard && npm run lint && npm run typecheck && npm test && npm run build && npm run check:bundle && npm run e2e
```

## Before making a change

1. Check `STATUS.md` first — it lists exactly what's done, what's
   blocked (and why), and what network sources are currently reachable
   from this environment. Don't rediscover a known blocker.
2. Check `DECISIONS.md` for prior judgment calls that might explain why
   something looks like it should be "fixed" but isn't.
3. Run `uv run pytest` and `uv run ruff check .` before and after; both
   must stay clean.
