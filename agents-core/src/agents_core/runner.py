"""`agents-run <agent> [--dry-run] [--apply] [extra args...]` — the
generic CLI every agent repo gets for free by depending on agents-core.

Unrecognized arguments are forwarded verbatim as `extra_args` to the
agent's own `run()`, so an agent can define flags of its own (e.g. a
`--force-briefs`) without agents-core needing to know about them.
"""

from __future__ import annotations

import argparse
import sys

from agents_core.registry import AgentNotFound, discover_agents, load_agent


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="agents-run")
    parser.add_argument("agent", nargs="?", help="Registered agent name")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch/compute only; agents should publish nothing and make no LLM calls.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Allow the agent to make live external changes. Semantics are agent-specific; most agents ignore this.",
    )
    parser.add_argument("--list", action="store_true", help="List registered agents and exit.")
    args, extra = parser.parse_known_args(argv)

    if args.list or not args.agent:
        for name, target in sorted(discover_agents().items()):
            print(f"{name} -> {target}")
        return 0

    try:
        run = load_agent(args.agent)
    except AgentNotFound as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    meta = run(dry_run=args.dry_run, apply=args.apply, extra_args=extra)

    print(
        f"[{args.agent}] status={meta.status} cost=${meta.cost_usd:.4f} "
        f"data_changed={meta.data_changed}"
    )
    for warning in getattr(meta, "warnings", None) or []:
        print(f"  warning: {warning}")
    return 0 if meta.status != "failed" else 1


if __name__ == "__main__":
    sys.exit(main())
