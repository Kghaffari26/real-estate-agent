# Autonomous session decisions

One line per consequential judgment call made while working unattended.

- Kghaffari26/agents-core has no commit (any branch) with `src/agents_core/{guards,registry}.py`: it's actually a monorepo named "agents-hub" internally (`core/*` namespace, class-based `Agent`/`fetch`/`transform`/`analyze` contract, `[tool.uv] package = false`, not pip-installable), not the installable `agents_core` package the instructions describe. Treating this as "no such commit exists yet" per the instructions' own fallback: doing step 3 (network-independent) now, then polling for the right commit periodically (ScheduleWakeup, not blocking sleep, since a single 15-min sleep exceeds this tool's max timeout) for up to ~4 hours before giving up and documenting the blocker in STATUS.md.
