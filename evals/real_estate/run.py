"""Offline brief evals (SPEC_REAL_ESTATE.md §11), kept as a shortcut for
`uv run agents-evals run evals.real_estate.suites:TEMPLATE_BRIEFS`.

The suites now live in `evals/real_estate/suites.py` on `agents_core.evals`, which
writes `evals/results/<date>.json` and appends to `evals/history.jsonl`. This entry
point runs only the free template suite (no network, no LLM); pass `--all` to also
run the LLM brief and investigator suites (needs an Anthropic key; about $0.20).

    uv run python -m evals.real_estate.run [--all] [--no-write]
"""

from __future__ import annotations

import argparse
import sys

from agents_core import settings
from agents_core.evals import run_suite

from evals.real_estate import suites


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--all", action="store_true", help="also run the LLM suites")
    parser.add_argument("--no-write", action="store_true", help="don't write results/history")
    args = parser.parse_args(argv)
    settings.load_dotenv()
    selected = [suites.TEMPLATE_BRIEFS] + ([suites.LLM_BRIEFS, suites.INVESTIGATOR] if args.all else [])
    for suite in selected:
        report = run_suite(suite, write=not args.no_write)
        scores = " ".join(f"{k}={v:.3f}" for k, v in report.scores.items())
        print(f"{report.suite}: pass_rate={report.pass_rate:.3f} {scores} usd={report.usd:.4f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
