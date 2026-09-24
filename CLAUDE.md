# real-estate-agent

A single scheduled data agent (`real_estate`) plus the framework it's
built on, kept in one repo. Full design: `docs/specs/SPEC_REAL_ESTATE.md`
(and `docs/specs/BUILD_PLAN.md` for how this fits a larger multi-agent
plan). Current status against the spec, including what's blocked and
why: `STATUS.md`. `DECISIONS.md` logs judgment calls made while working
unattended — read it before assuming something here was a mistake rather
than a deliberate, documented choice.

## Architecture

```
real-estate-agent/
├── agents-core/            # vendored framework package (see naming note below)
│   └── src/agents_core/    # http, costs, publish, schema, manifest, models, paths, registry, runner
├── agents/real_estate/     # fetch_*.py, transform.py, compute.py, temperature.py,
│                           # flags.py, movers.py, templates.py, analyze.py, schema.py,
│                           # state.py, config.py, metrics.py, agent.py (orchestration)
├── config/                 # metros.toml, real_estate.toml
├── scripts/                # verify_re_sources.py, build_metro_config.py, export_re_schema.py
├── data/                   # committed: real_estate/state.json. gitignored: cache/, costs.jsonl
├── public-data/            # gitignored, regenerated: agents_core.paths.publish_dir() output
├── evals/real_estate/      # offline eval suite (SPEC §11), no network/LLM calls
└── tests/                  # HTTP mocked (respx), fixtures under tests/fixtures/real_estate/
```

Data flow: **fetch (conditional GET) → transform/compute (pure Python,
no LLM) → flags + temperature → movers → brief (template today; LLM
later) → validate (pydantic) → publish JSON, with dated history.**

**Naming note:** `Kghaffari26/agents-core` also exists as a separate
GitHub repo, but it's a different, incompatible architecture (an
`agents-hub` monorepo expecting each agent physically inside it as a
`core.agent.Agent` subclass). This repo's `agents-core/` is its *own*
vendored copy built to a different, entry-point-based contract — see
`STATUS.md`'s "Needed from agents-core" section before trying to make
this repo depend on the external one, and `agents-core/README.md`'s
naming note.

## Rules

- **Numbers come from Python, never from an LLM.** Every YoY/MoM change,
  36-month high/low, percentile rank, the temperature z-score, every flag
  threshold, and the affordability calculator are deterministic and
  unit-tested. When an LLM brief path is eventually wired up, it narrates
  numbers already computed in `agents/real_estate/analyze.py`'s facts
  dict — it never computes or introduces a new one.
- **No LLM calls exist in this build yet.** `agents/real_estate/
  templates.py` generates every brief deterministically
  (`narrative_source: "template"`); `analyze.py` is the seam an LLM path
  plugs into later without other code changing. Don't add an `anthropic`
  import or a bespoke LLM client here — see the "Needed from
  agents-core" note in `STATUS.md` for why, and never write a
  replacement `agents_core.llm`/`guards` module locally.
- **All HTTP goes through `agents_core.http.HTTPClient`**, which handles
  retries, per-host rate limiting, a TTL cache for small responses, and
  conditional-GET for large files (Redfin's tracker). Never call `httpx`
  directly from a fetcher.
- **A metro's brief regenerates only when its facts actually changed**
  (SHA-256 hash in `data/real_estate/state.json`, excluding rate/
  affordability fields so a mortgage-rate move alone doesn't touch metro
  briefs — only the national brief's hash includes rates). Preserve this
  when touching `agent.py` or `state.py`.
- **Optional sources degrade to `null`, they never fail the run**: Zillow,
  Census permits, and ACS income all catch their own exceptions and log a
  warning in `meta.warnings` (SPEC §10). Redfin and, once wired up, the
  LLM path do not have this exemption.
- **Published JSON stays small**: index ≤150KB, each metro file ≤40KB
  (`config/real_estate.toml`'s `max_index_kb`/`max_metro_kb`,
  `core.publish.PublishSizeError` enforces it). If a change grows the
  payload, check real output sizes before committing, not just tests.
- **Keep published paths generic.** Nothing should assume
  `site/public/data`; use `agents_core.paths.publish_dir()` /
  `data_dir()` (env-overridable) instead of hardcoding a path.
- Secrets come from environment variables only (`ANTHROPIC_API_KEY`,
  `FRED_API_KEY`, `CENSUS_API_KEY`). Never commit them; `.env.example`
  lists what's expected.
- Respect source terms: attribute Redfin, Zillow, FRED, and the Census
  Bureau wherever the data is shown, and don't redistribute raw datasets.

## Commands

```bash
uv sync                                    # install (agents-core included, local path dep)
uv run agents-run real_estate --dry-run    # fetch + compute, skip publish, zero LLM calls
uv run agents-run real_estate              # real run, publishes to public-data/
uv run agents-run --list                   # show every registered agent
uv run pytest                              # this repo's tests
uv run python -m evals.real_estate.run     # offline eval suite (SPEC §11)
uv run ruff check .
uv run python scripts/verify_re_sources.py     # check which data-source URLs are reachable
uv run python scripts/build_metro_config.py    # regenerate config/metros.toml from live Redfin
cd agents-core && uv run pytest && uv run ruff check .   # the vendored framework's own tests
```

## Before making a change

1. Check `STATUS.md` first — it lists exactly what's done, what's
   blocked (and why), and what network sources are currently reachable
   from this environment. Don't rediscover a known blocker.
2. Check `DECISIONS.md` for prior judgment calls that might explain why
   something looks like it should be "fixed" but isn't.
3. Run `uv run pytest` and `uv run ruff check .` before and after; both
   must stay clean.
