"""CLI entry point: `python -m core.runner <agent> [--dry-run] [--force-briefs]`."""

from __future__ import annotations

import argparse
import importlib
import sys

AGENTS = {
    "real_estate": "agents.real_estate.agent",
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="core.runner")
    parser.add_argument("agent", choices=sorted(AGENTS))
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and compute, print a table, publish nothing, make no LLM calls.",
    )
    parser.add_argument(
        "--force-briefs",
        action="store_true",
        help="Regenerate every brief regardless of cached facts hashes.",
    )
    args = parser.parse_args(argv)

    module = importlib.import_module(AGENTS[args.agent])
    meta = module.run(dry_run=args.dry_run, force_briefs=args.force_briefs)

    print(
        f"[{args.agent}] status={meta.status} cost=${meta.cost_usd:.4f} "
        f"data_changed={meta.data_changed}"
    )
    if meta.warnings:
        for w in meta.warnings:
            print(f"  warning: {w}")
    return 0 if meta.status != "failed" else 1


if __name__ == "__main__":
    sys.exit(main())
