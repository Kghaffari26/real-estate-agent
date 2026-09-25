# real-estate-agent

A scheduled data agent that tracks the U.S. housing market nationally and
across the 50 largest metros — sales, prices, inventory, days on market,
price cuts, rents, and new-construction permits, set against mortgage
rates — computes every number in code, flags notable shifts (an inventory
surge, a market crossing into buyer's/seller's territory, price cuts at a
36-month high...), and writes a short plain-English brief per metro plus a
national summary. Built for a portfolio site: point it at
`public-data/real_estate/` and it's ready to render a metro explorer, an
affordability calculator, and a "what changed this week" page.

Full design: `docs/specs/SPEC_REAL_ESTATE.md`. Current status against
that spec, plus what's blocked and why: `STATUS.md`.

## Sample output

A real run against live Redfin data, published to
`public-data/real_estate/metros/austin-tx.json`:

```json
{
  "slug": "austin-tx",
  "name": "Austin, TX",
  "data_through": "2026-05-31",
  "latest": {
    "median_sale_price": { "value": 447540, "yoy": 0.006, "trend_3m": "flat" },
    "inventory": { "value": 12880, "yoy": -0.089, "trend_3m": "down" },
    "months_of_supply": { "value": 5.4 }
  },
  "temperature": { "score": 16, "label": "Cold" },
  "market_type": "Balanced",
  "flags": [],
  "brief": {
    "text": "Austin, TX's median sale price was $447,540 in May 2026, up 0.6% from a year earlier. Inventory fell 8.9% YoY, and homes spent a median 58 days on market. The market is Cold relative to the 50 largest metros.",
    "narrative_source": "template"
  }
}
```

`narrative_source: "template"` because the LLM brief-generation path
isn't wired up yet — see "How it works" below.

## How it works

```
fetch (conditional GET) → filter/normalize → compute (YoY/MoM/trend/
  percentile-rank) → flags + market temperature → movers → brief
  (template today; LLM later) → validate against a pydantic schema →
  publish JSON, with dated history
```

- **Data sources**: Redfin's public Data Center (metro + national market
  tracker), Zillow Research (ZHVI/ZORI), FRED (mortgage rates, housing
  starts, Case-Shiller), and the Census Bureau (building permits, ACS
  income, Gazetteer centroids). Zillow/permits/ACS are optional — a
  fetch failure degrades to `null` for that field rather than failing the
  run; FRED's mortgage rate is used for affordability but the pipeline
  still runs and publishes without it if unreachable.
- **Every number comes from Python, not an LLM.** YoY/MoM changes,
  36-month highs/lows, percentile ranks, the market-temperature z-score,
  every flag threshold, and the amortization-based affordability
  calculator are all deterministic and unit-tested
  (`tests/test_compute.py`, `test_affordability.py`, `test_temperature.py`,
  `test_flags.py`).
- **Briefs are currently template-only.** `agents/real_estate/templates.py`
  builds each metro's brief straight from its computed facts (no LLM call,
  `narrative_source: "template"`); `analyze.py` is the seam where an LLM
  path plugs in later without other code needing to change. A metro's
  brief is only rebuilt when its underlying facts actually changed
  (hash-cached in `data/real_estate/state.json`), so a run where nothing
  moved touches zero briefs.
- **Registration**: this agent registers under the `agents_core.agents`
  entry-point group and runs via the generic `agents-run` console script
  from the local `agents-core/` package (see `STATUS.md` for why this repo
  still vendors its own `agents-core/` rather than depending on an
  external one — short version: the external `Kghaffari26/agents-core`
  repo turned out to be a different, incompatible architecture, so this
  repo keeps its own working copy rather than breaking everything to
  chase a mismatch).

## Setup

```bash
uv sync   # installs agents-core from ./agents-core as a local editable dependency
cp .env.example .env   # optional; not required for template-only briefs
```

## Running

```bash
# Full pipeline, prints a per-metro table, makes no network calls beyond
# fetching, and writes nothing.
uv run agents-run real_estate --dry-run

# Real run: fetches, computes, publishes public-data/real_estate/.
uv run agents-run real_estate

# List every agent registered in this environment.
uv run agents-run --list
```

Published output goes to `public-data/` by default — override with
`AGENTS_CORE_PUBLISH_DIR` (see `agents-core/README.md` for every
configurable path).

## Costs

**$0 so far** — there are no LLM calls anywhere in this build yet (see
"How it works"), so `data/costs.jsonl` stays empty and every run's
`cost=$0.0000`. Once LLM briefs are wired up, the spec budgets
metro briefs (fast tier, Batch API) at ~$0.05/full refresh and the
national brief (smart tier) at ~$0.025/run, for roughly $0.20/month
scheduled weekly — well under the `MAX_RUN_USD=0.50` per-run cap
`agents_core.costs.CostTracker` enforces.

## Tests

```bash
uv run pytest              # this agent's tests — 185 passing, HTTP mocked (respx), no live network
uv run ruff check .

uv run python -m evals.real_estate.run   # offline eval suite (SPEC §11) — see STATUS.md for results

cd agents-core && uv run pytest && uv run ruff check .   # the vendored framework's own tests
```

Fixtures live in `tests/fixtures/real_estate/`.

## Config

- `config/metros.toml` — the 50 tracked metros (Redfin region name, Zillow
  RegionID, CBSA code, lat/lon). Generated by `scripts/build_metro_config.py`
  from live Redfin data, then hand-reviewed. As of this build, the Zillow
  RegionID/CBSA/lat-lon columns are still `# REVIEW`-flagged pending
  network access to Zillow/Census — see STATUS.md.
- `config/real_estate.toml` — flag thresholds and pipeline settings.
- `config/models.toml` (optional) — overrides `agents-core`'s default
  model tiers/pricing; not needed yet since this agent makes no LLM calls.

## Network note

`scripts/verify_re_sources.py` and the fetchers talk to Redfin's public S3
bucket, Zillow Research, the Census Bureau, and FRED. In sandboxed dev
environments with restrictive egress policies, only some of these hosts may
be reachable — check with `verify_re_sources.py` before assuming a fetch
failure is a bug in the code rather than network policy. Current status:
only Redfin is reachable; see STATUS.md for the exact check.
