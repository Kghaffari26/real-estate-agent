# agents-core (vendored copy — see naming note)

Shared framework for the agents-hub family of scheduled data agents:
HTTP caching (conditional GET + TTL cache), cost tracking, a JSON
publisher with size limits and dated history, a manifest/costs-summary
convention for multi-repo dashboards, model-tier/pricing config, and
agent registration via Python entry points.

It ships no agents of its own — it's a dependency, not a standalone tool.

> **Naming note:** a separate `Kghaffari26/agents-core` GitHub repo also
> exists, but it's a different, incompatible architecture — a monorepo
> (internally named "agents-hub") that expects each agent's code to live
> physically inside it as a `core.agent.Agent` subclass, not something
> installed via `uv add`. This package is real-estate-agent's *own* copy,
> built independently to the `src/agents_core/` + entry-point contract
> described in `../STATUS.md`. Don't confuse the two — see
> `../STATUS.md`'s "Needed from agents-core" section for the full story
> and what would need to change for this repo to actually depend on the
> external one instead of vendoring this copy.

## Install

As a local path dependency (how `real-estate-agent` itself uses it —
see its root `pyproject.toml`'s `[tool.uv.sources]`):

```toml
[project]
dependencies = ["agents-core"]

[tool.uv.sources]
agents-core = { path = "agents-core", editable = true }
```

As a git+subdirectory dependency, if you clone just this package out to
somewhere else (untested since the naming note above surfaced — treat
this as aspirational until verified):

```bash
uv add "git+https://github.com/Kghaffari26/real-estate-agent@<ref>#subdirectory=agents-core"
```

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

**Removed.** A prior version of this package shipped its own
`.github/workflows/run-agent.yml`, callable cross-repo. It was deleted
because the real `Kghaffari26/agents-core` repo (see the naming note up
top) now owns that name and has its *own* `run-agent.yml` — with a
different, incompatible contract (`agent`/`args` inputs only, and it
expects the calling repo to implement `python -m core.runner`, the
`agents-hub` monorepo pattern, not this package's entry-point contract).
`real-estate-agent`'s `.github/workflows/agent-real-estate.yml` currently
calls that external workflow and documents exactly why it doesn't work
yet — see `../STATUS.md`. If this package's own reusable workflow is
needed again, it should be rebuilt to call `agents-run` directly rather
than reusing the `run-agent.yml` name.

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
