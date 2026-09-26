# real-estate-agent

A scheduled data agent that tracks the U.S. housing market nationally and
across the 50 largest metros — sales, prices, inventory, days on market,
price cuts, rents, and new-construction permits, set against mortgage
rates. It computes every number in code, flags notable shifts (an inventory
surge, a market crossing into buyer's/seller's territory, price cuts at a
36-month high...), and has Claude write a short plain-English brief per metro
plus a national summary, each checked number-by-number against the computed
facts. Built on [`agents-core`](https://github.com/Kghaffari26/agents-core)
v0.1.0, publishing to its data-branch contract for a portfolio site's metro
explorer, affordability calculator, and "what changed this week" page.

Full design: `docs/specs/SPEC_REAL_ESTATE.md`. Current status against
that spec, plus what's blocked and why: `STATUS.md`.

## Sample output

From the first real run (2026-09-26), `public-data/metros/austin-tx.json`, abridged:

```json
{
  "slug": "austin-tx",
  "name": "Austin, TX",
  "cbsa": "12420",
  "data_through": "2026-05-31",
  "latest": {
    "median_sale_price": {
      "value": 447540.0,
      "yoy": 0.005707865168539383,
      "trend_3m": "up"
    },
    "inventory": {
      "value": 15220.0,
      "yoy": -0.08873188839659918,
      "trend_3m": "up"
    }
  },
  "temperature": {
    "score": 16,
    "label": "Cold"
  },
  "market_type": "Balanced",
  "flags": [
    "rent_outpacing"
  ],
  "brief": {
    "text": "Austin's rental market shows mixed signals through May 2026. Median home prices rose 0.6% year-over-year to $447,540, while inventory fell 8.9% to 15,220 listings. Rent declined 2.3% to $1,608/month, though rent growth is outpacing home values. The market remains balanced with 5.2 months of supply and a 97.6% sale-to-list ratio.",
    "key_points": [
      "Inventory down 8.9% year-over-year",
      "Home prices up 0.6% to $447,540",
      "Rent growth outpacing home values"
    ],
    "narrative_source": "llm",
    "model": "claude-haiku-4-5-20251001",
    "reused": true
  }
}
```

The brief is Claude's (Haiku 4.5, via the Batch API), and every number in it was checked
against the facts `compute.py` produced before it was published.

## How it works

```
fetch (conditional GET) → filter/normalize → compute (YoY/MoM/trend/
  percentile-rank) → flags + market temperature → movers → facts dicts
  → briefs (Claude, only where facts changed; number guard; template
  fallback) → validate against a pydantic schema → publish JSON + history
```

- **Framework**: `agents/real_estate/agent.py` defines `RealEstateAgent`, an
  `agents_core.agent.Agent` (fetch → transform → analyze), registered under
  the `agents_core.agents` entry point in `pyproject.toml`. agents-core's
  `agents-run` does the rest: validation, publishing, cost tracking, the
  manifest entry, and the JSON Schema.
- **Data sources**: Redfin's public Data Center (metro + national market
  tracker), Zillow Research (ZHVI/ZORI), FRED (mortgage rates, housing
  starts, Case-Shiller), and the Census Bureau (ACS income, Gazetteer
  centroids; building permits are wired but disabled until the monthly file
  layout is verified). Zillow/permits/ACS/FRED are optional: a failure
  degrades that field to `null` and logs a warning instead of failing the run.
- **Every number comes from Python, not an LLM.** YoY/MoM changes,
  36-month highs/lows, percentile ranks, the market-temperature z-score,
  every flag threshold, the headline, and the amortization-based
  affordability calculator are deterministic and unit-tested.
- **Briefs**: metro briefs use the fast tier through Anthropic's Batch API
  (half price); the national brief uses the smart tier. Both go through
  `agents_core.llm` with `fields_guard(facts, ["text", "key_points"])`: a
  number that isn't in the facts gets one retry, then the deterministic
  template from `templates.py` (`narrative_source: "template"`).
- **Caching**: a brief is regenerated only when the facts it was written from
  change (SHA-256 in `data/real_estate/state.json`, briefs cached in
  `data/real_estate/briefs.json`). Metro briefs don't see mortgage rates, so
  a rate-only week regenerates just the national brief, and an unchanged
  week makes zero LLM calls.

## Setup

```bash
uv sync                 # Python 3.12; installs agents-core v0.1.0 from git
cp .env.example .env    # ANTHROPIC_API_KEY (or AGENTS_ANTHROPIC_API_KEY), FRED_API_KEY, CENSUS_API_KEY
```

## Running

```bash
uv run agents-run real_estate --dry-run        # fetch + compute, print a per-metro table; no LLM, no publish
uv run agents-run real_estate                  # real run: briefs + publish to public-data/
uv run agents-run real_estate --force-briefs   # regenerate every brief
uv run agents-run --list                       # every registered agent
```

Output follows the agents-core data-branch contract, in `public-data/`
(override with `AGENTS_CORE_PUBLISH_DIR`):

```
public-data/
├── latest.json              # the index (§6.1): national block, 50 metro summaries, movers, alerts
├── metros/<slug>.json       # one per metro (§6.2): full series, flags, affordability, brief
├── history/YYYY-MM-DD.json  # dated index snapshots, 52 kept
├── manifest-entry.json      # headline, key stats, run cost, status
├── costs-summary.json       # this agent's monthly/all-time LLM spend
└── schema.json              # latest.json's JSON Schema
```

In CI, `.github/workflows/agent-real-estate.yml` runs this weekly (Fridays
08:00 PT) through agents-core's reusable `run-agent.yml@v0.1.0`, which
commits `data/` (cost log, guard failures, brief cache) back to the branch
and force-pushes `public-data/` to the `data` branch.

## Costs

The first real run (all 50 metro briefs plus the national brief, from an empty
cache) cost **$0.0457**, logged in `data/costs.jsonl`:

| Calls | Tier / mode | Cost |
|---|---|---|
| 50 metro briefs | fast (Haiku 4.5), Batch API | $0.0367 |
| 2 guard retries | fast, synchronous | $0.0031 |
| 1 national brief | smart (Sonnet 5), synchronous | $0.0059 |

The immediate second run cost $0.00 (0 calls, every brief reused). Weekly
runs where only the mortgage rate moved regenerate just the national brief
(about $0.006). Every run is capped at `MAX_RUN_USD=0.50`
(agents-core's `CostTracker` fails the run before it would cross that).

## Tests

```bash
uv run pytest                              # HTTP mocked (respx), Anthropic faked; no network, no spend
uv run ruff check .
uv run python -m evals.real_estate.run     # offline eval suite (SPEC §11) — see STATUS.md
```

`tests/test_agent_run.py` runs the whole agent through agents-core's own
runner offline, checking every data-branch file and that a second run makes
zero LLM calls. Fixtures live in `tests/fixtures/real_estate/`.

## Config

- `config/metros.toml` — the 50 tracked metros (Redfin region name, Zillow
  RegionID, CBSA code, lat/lon), generated by `scripts/build_metro_config.py`
  from live Redfin, Zillow and Census Gazetteer data, then hand-reviewed.
  Remaining `# REVIEW` lines are listed in STATUS.md.
- `config/real_estate.toml` — flag thresholds and pipeline settings
  (including the index/metro size limits and the batch timeout).
- `config/models.toml` (optional) — overrides agents-core's default model
  tiers/pricing.

## Network note

`scripts/verify_re_sources.py` checks every source URL. All of them were
reachable from the last dev session; the Census API now needs
`CENSUS_API_KEY` for ACS income.
