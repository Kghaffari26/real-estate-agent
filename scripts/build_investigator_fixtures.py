"""Build the investigator's trajectory-eval fixtures from live data (no LLM calls).

Runs the agent's fetch + transform (like `agents-run real_estate --dry-run`),
takes the investigator `World` it builds, and writes:

- `evals/real_estate/investigator_world.json`: the world restricted to the 6
  fixture metros, their 5 same-region peers each, plus the national and rate series.
- `evals/real_estate/investigator_cases.jsonl`: one `agents_core.evals.EvalCase` per
  fixture metro (target + expected/forbidden tools).

The six cases cover a top mover on price, one on inventory, a falling-inventory
market, a cold market, a hot market, and a run with no rate data (FRED down), where
`get_rate_history` isn't offered and must not be called. Triggers reuse each metro's
real flag labels and YoY figures; they're investigation prompts, not claims that the
flag was `major` this month.

    uv run python scripts/build_investigator_fixtures.py
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # run as a plain script

from agents_core import settings  # noqa: E402
from agents_core.agent import RunContext  # noqa: E402
from agents_core.costs import CostTracker  # noqa: E402
from agents_core.http import Http  # noqa: E402
from agents_core.llm import LLM  # noqa: E402

from agents.real_estate import investigate  # noqa: E402
from agents.real_estate.agent import AGENT  # noqa: E402

OUT_DIR = Path("evals/real_estate")
# (case id, slug, trigger, trigger metric, drop rate data)
CASES = [
    ("price-gainer", "pittsburgh-pa", "top_mover", "median_sale_price", False),
    ("inventory-surge", "fort-lauderdale-fl", "top_mover", "inventory", False),
    ("inventory-drop", "cape-coral-fl", "new_major_flag", "inventory", False),
    ("cold-market", "miami-fl", "new_major_flag", "inventory", False),
    ("hot-market", "st-louis-mo", "top_mover", "median_sale_price", False),
    ("no-rate-data", "seattle-wa", "top_mover", "median_sale_price", True),
]
REQUIRED = ["get_metro_series", "compare_to_peers"]


def _label(world: investigate.World, slug: str, metric: str) -> tuple[str, str | None]:
    m = world.metros[slug]
    for f in m.flags:
        if (metric == "inventory" and f.id.startswith("inventory")) or (
            metric == "median_sale_price" and f.id in ("price_decline", "price_surge")
        ):
            return f.label, f.id
    latest = investigate._latest(metric, m.dates, m.series[metric])
    change = latest[investigate._change_key(metric)]
    name = "Median price" if metric == "median_sale_price" else "Inventory"
    return f"{name} {change:+.1f}% YoY", None


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings.load_dotenv()
    tracker = CostTracker(agent=AGENT.id, run_id="fixtures", path=Path("/dev/null"))
    with Http() as http:
        AGENT.configure_http(http)
        ctx = RunContext(
            agent_id=AGENT.id,
            run_id="fixtures",
            started_at=datetime.now(UTC),
            http=http,
            llm=LLM(tracker),
            costs=tracker,
            dry_run=True,
        )
        data = AGENT.transform(ctx, AGENT.fetch(ctx))
    world = data.world
    assert world is not None

    keep: set[str] = set()
    cases = []
    for case_id, slug, trigger, metric, drop_rates in CASES:
        box = investigate.Toolbox(world)
        peers = box.peers(investigate.PeerQuery(slug=slug, metric=metric))["peers"]
        keep |= {slug} | {s for s, m in world.metros.items() if m.name in {p["metro"] for p in peers}}
        label, flag = _label(world, slug, metric)
        cases.append(
            {
                "id": case_id,
                "input": {
                    "slug": slug,
                    "name": world.metros[slug].name,
                    "trigger": trigger,
                    "trigger_flag": flag,
                    "trigger_label": label,
                    "trigger_metric": metric,
                    "drop_rates": drop_rates,
                },
                "expected": {
                    "required_tools": REQUIRED,
                    "forbidden_tools": ["get_rate_history"] if drop_rates else [],
                    "trigger_metric": metric,
                },
                "tags": [trigger] + (["no_rates"] if drop_rates else []),
            }
        )

    fixture = world.model_copy(update={"metros": {s: world.metros[s] for s in sorted(keep)}})
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "investigator_world.json").write_text(fixture.model_dump_json(indent=None) + "\n")
    with (OUT_DIR / "investigator_cases.jsonl").open("w") as f:
        for case in cases:
            f.write(json.dumps(case) + "\n")
    print(f"wrote {len(cases)} cases over {len(keep)} metros (data through {world.data_through})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
