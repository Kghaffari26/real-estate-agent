# real-estate-agent

Tracks the U.S. housing market nationally and across the 50 largest metros:
sales, prices, inventory, speed, price cuts, rents and new-construction
permits, set against mortgage rates. Computes everything in code, flags
notable shifts, and (eventually) writes a short plain-English brief per
metro plus a national summary.

Full design: `docs/specs/SPEC_REAL_ESTATE.md`.

## Repo layout

This is a small monorepo: the `real_estate` agent plus the shared
framework it's built on, kept in one place rather than split across repos.

```
real-estate-agent/
├── agents-core/          # standalone, independently installable package
│   └── src/agents_core/  # HTTP caching, cost tracking, publish, entry-point registry
├── agents/real_estate/   # this agent, registered as an agents_core.agents entry point
├── config/                # metros.toml, real_estate.toml
├── scripts/               # verify_re_sources.py, build_metro_config.py, export_re_schema.py
├── data/                  # committed state (data/real_estate/state.json) + gitignored cache
├── public-data/           # gitignored: regenerated output (agents_core.paths.publish_dir())
└── .github/workflows/run-agent.yml   # reusable workflow, callable from other repos too
```

`agents-core` has its own `pyproject.toml`/tests/README and is meant to be
usable by *other* agent repos, not just this one — see
[`agents-core/README.md`](agents-core/README.md) for its own docs, and
"Using agents-core in an agent repo" below for the install story.

## Status

This build covers the data pipeline end-to-end — fetch, compute, flags,
temperature, movers, publish — with **deterministic template briefs**
(no LLM calls yet). `agents/real_estate/analyze.py` is the seam where the
Batch API brief generation from the spec (§7) plugs in later; until then
every brief's `narrative_source` is `"template"`.

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

`agents-run` comes from `agents-core`; `real_estate` is registered under
the `agents_core.agents` entry-point group in this repo's `pyproject.toml`.
Published output goes to `public-data/` by default — override with
`AGENTS_CORE_PUBLISH_DIR` (see `agents-core`'s README for the full list of
configurable paths).

## Tests

```bash
uv run pytest              # this agent's tests
uv run ruff check .

cd agents-core && uv run pytest && uv run ruff check .   # the framework's own tests
```

All HTTP in tests is mocked (`respx`); fixtures live in
`tests/fixtures/real_estate/`.

## Config

- `config/metros.toml` — the 50 tracked metros (Redfin region name, Zillow
  RegionID, CBSA code, lat/lon). Generated once by
  `scripts/build_metro_config.py`, then hand-reviewed.
- `config/real_estate.toml` — flag thresholds and pipeline settings.
- `config/models.toml` (optional) — overrides `agents-core`'s default
  model tiers/pricing; not needed yet since this agent makes no LLM calls.

## Using agents-core in an agent repo

`agents-core` isn't specific to real estate — any scheduled data-agent
repo can depend on it. From another repo:

```bash
uv add "git+https://github.com/Kghaffari26/real-estate-agent@v0.1.0#subdirectory=agents-core"
```

(It ships from a subdirectory of this repo rather than its own top-level
repo — this repo already existed and holds the real_estate agent, and a
git+subdirectory reference is exactly as installable as a dedicated repo
would be.)

Then register your agent and get the CLI for free:

```toml
# your pyproject.toml
[project.entry-points."agents_core.agents"]
my_agent = "my_package.my_agent:run"
```

```python
# my_package/my_agent.py
from agents_core.schema import RunMeta

def run(*, dry_run=False, apply=False, extra_args=None) -> RunMeta:
    ...
```

```bash
uv run agents-run my_agent --dry-run
```

And call the reusable CI workflow instead of writing your own:

```yaml
jobs:
  run:
    uses: Kghaffari26/real-estate-agent/.github/workflows/run-agent.yml@v0.1.0
    with:
      agent: my_agent
      max_run_usd: "0.50"
      site_repo: your-org/website   # optional; enables the repository_dispatch notification
    secrets: inherit
```

See `agents-core/README.md` for the full module list and the
`run-agent.yml` workflow file itself for every input/secret it accepts.

## Network note

`scripts/verify_re_sources.py` and the fetchers talk to Redfin's public S3
bucket, Zillow Research, the Census Bureau, and FRED. In sandboxed dev
environments with restrictive egress policies, only some of these hosts may
be reachable — check with `verify_re_sources.py` before assuming a fetch
failure is a bug in the code rather than network policy.
