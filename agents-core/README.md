# agents-core

Shared framework for the agents-hub family of scheduled data agents:
HTTP caching (conditional GET + TTL cache), cost tracking, a JSON
publisher with size limits and dated history, a manifest/costs-summary
convention for multi-repo dashboards, model-tier/pricing config, and
agent registration via Python entry points.

It ships no agents of its own — it's a dependency, not a standalone tool.

## Install

As a git dependency (from another repo):

```bash
uv add "git+https://github.com/Kghaffari26/real-estate-agent@v0.1.0#subdirectory=agents-core"
```

(agents-core lives in a subdirectory of the `real-estate-agent` repo
rather than its own top-level repo — see that repo's README for why.)

As a local path dependency (developing alongside an agent repo in the
same checkout, as `real-estate-agent` itself does):

```toml
[project]
dependencies = ["agents-core"]

[tool.uv.sources]
agents-core = { path = "../agents-core" }
```

## Registering an agent

An agent repo exposes a `run` callable and registers it under the
`agents_core.agents` entry-point group in its own `pyproject.toml`:

```toml
[project.entry-points."agents_core.agents"]
my_agent = "my_package.my_agent:run"
```

```python
# my_package/my_agent.py
from agents_core.schema import RunMeta

def run(*, dry_run: bool = False, apply: bool = False, extra_args: list[str] | None = None) -> RunMeta:
    ...
```

- `dry_run`: fetch/compute only — publish nothing, make no LLM calls.
- `apply`: allow live external side effects (posting comments, applying
  labels, etc.) — most agents ignore this; it exists for agents like a
  repo-maintenance bot that are read-only by default.
- `extra_args`: anything the generic CLI didn't recognize, forwarded
  verbatim so an agent can define its own flags (e.g. `--force-briefs`)
  without agents-core needing to know about them.

Once installed, the agent is runnable via the `agents-run` console
script agents-core provides:

```bash
agents-run my_agent --dry-run
agents-run --list          # show every registered agent
```

## Modules

| Module | What it's for |
|---|---|
| `agents_core.http` | `HTTPClient`: retries, per-host rate limiting, a TTL cache for `get_json`/`get_text`/`get_bytes`, and conditional-GET `download()` for large files that publish an ETag/Last-Modified. |
| `agents_core.costs` | `CostTracker` (per-run spend log + a `BudgetExceeded` guard) and `summarize_costs`/`publish_costs_summary` for a monthly `costs-summary.json`. |
| `agents_core.publish` | `write_json` (with a size-budget guard), `publish_index` (latest.json + dated history, auto-trimmed), `publish_item` (per-record files). |
| `agents_core.manifest` | `ManifestEntry` + `publish_manifest_entry`, so a website (or a combined dashboard) can assemble a manifest across agents without agent-specific knowledge. |
| `agents_core.models` | Loads `config/models.toml` (tiers → model id, per-model pricing), merging an agent repo's overrides onto the package's shipped defaults. |
| `agents_core.paths` | `data_dir()`/`publish_dir()` — configurable via `$AGENTS_CORE_DATA_DIR`/`$AGENTS_CORE_PUBLISH_DIR`, default `data/`/`public-data/`. |
| `agents_core.registry` / `agents_core.runner` | Entry-point discovery and the `agents-run` CLI. |
| `agents_core.schema` | `RunMeta`, `Citation` — the bookkeeping models every agent's output includes. |

None of these assume a `site/public/data`-shaped layout, a specific
website framework, or a specific LLM provider.

## The reusable `run-agent.yml` workflow

Call it from an agent repo's own workflow:

```yaml
jobs:
  run:
    uses: Kghaffari26/real-estate-agent/.github/workflows/run-agent.yml@v0.1.0
    with:
      agent: real_estate
      max_run_usd: "0.50"
    secrets: inherit
```

It checks out the calling repo, `uv sync`s it, runs `agents-run <agent>`,
commits `data/` to `main`, force-pushes `public-data/` plus any exported
JSON Schemas to a `data` branch, and — only if `SITE_DISPATCH_TOKEN` is
set — sends a `repository_dispatch` (`agent-data-updated`) to the website
repo so it can rebuild. See the workflow file itself for the full input
list; it's a thin, generic wrapper, not agent-specific.

## Tests

```bash
uv sync
uv run pytest
uv run ruff check .
```

`tests/test_install_entry_point.py` is a real (not mocked) integration
test: it builds a temp project depending on agents-core via a local path,
`uv sync`s it, and runs a dummy agent through the actual `agents-run`
console script — proving the packaging works, not just the Python API.
