# real-estate-agent

Tracks the U.S. housing market nationally and across the 50 largest metros:
sales, prices, inventory, speed, price cuts, rents and new-construction
permits, set against mortgage rates. Computes everything in code, flags
notable shifts, and (eventually) writes a short plain-English brief per
metro plus a national summary.

Full design: `docs/specs/SPEC_REAL_ESTATE.md`.

## Status

This build covers the data pipeline end-to-end — fetch, compute, flags,
temperature, movers, publish — with **deterministic template briefs**
(no LLM calls yet). `agents/real_estate/analyze.py` is the seam where the
Batch API brief generation from the spec (§7) plugs in later; until then
every brief's `narrative_source` is `"template"`.

## Setup

```bash
uv sync
cp .env.example .env   # optional; not required for template-only briefs
```

## Running

```bash
# Full pipeline, prints a per-metro table, makes no network calls beyond
# fetching, and writes nothing.
uv run python -m core.runner real_estate --dry-run

# Real run: fetches, computes, publishes site/public/data/real_estate/.
uv run python -m core.runner real_estate
```

## Tests

```bash
uv run pytest
uv run ruff check .
```

All HTTP in tests is mocked (`respx`); fixtures live in
`tests/fixtures/real_estate/`.

## Config

- `config/metros.toml` — the 50 tracked metros (Redfin region name, Zillow
  RegionID, CBSA code, lat/lon). Generated once by
  `scripts/build_metro_config.py`, then hand-reviewed.
- `config/real_estate.toml` — flag thresholds and pipeline settings.

## Network note

`scripts/verify_re_sources.py` and the fetchers talk to Redfin's public S3
bucket, Zillow Research, the Census Bureau, and FRED. In sandboxed dev
environments with restrictive egress policies, only some of these hosts may
be reachable — check with `verify_re_sources.py` before assuming a fetch
failure is a bug in the code rather than network policy.
