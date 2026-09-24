"""Per-run cost tracking, a spend guard, and cross-run cost summaries.

Every LLM call an agent makes should go through `CostTracker.record`,
which appends a line to `<data_dir>/costs.jsonl` and raises
`BudgetExceeded` once the running total for *this run* crosses
`max_run_usd`. `summarize_costs`/`publish_costs_summary` roll that log up
into a small `costs-summary.json` per agent, which a website repo (or a
combined dashboard in a single-repo setup) can aggregate across agents
without parsing every agent's raw log itself.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from agents_core.paths import data_dir as default_data_dir
from agents_core.paths import publish_dir as default_publish_dir
from agents_core.publish import write_json


def _default_costs_path() -> Path:
    return default_data_dir() / "costs.jsonl"


class BudgetExceeded(RuntimeError):
    """Raised when a single run's LLM spend crosses its MAX_RUN_USD cap."""


@dataclass
class CostTracker:
    agent: str
    max_run_usd: float
    costs_path: Path = field(default_factory=_default_costs_path)
    total_usd: float = field(default=0.0, init=False)
    calls: int = field(default=0, init=False)

    def record(
        self,
        *,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
        purpose: str = "",
        batch: bool = False,
    ) -> None:
        self.total_usd += cost_usd
        self.calls += 1
        self.costs_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.costs_path, "a") as f:
            f.write(
                json.dumps(
                    {
                        "ts": time.time(),
                        "agent": self.agent,
                        "model": model,
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "cost_usd": cost_usd,
                        "purpose": purpose,
                        "batch": batch,
                    }
                )
                + "\n"
            )
        if self.total_usd > self.max_run_usd:
            raise BudgetExceeded(
                f"{self.agent}: run cost ${self.total_usd:.4f} exceeded "
                f"MAX_RUN_USD=${self.max_run_usd:.2f} after {self.calls} calls"
            )


@dataclass(frozen=True)
class CostsSummary:
    agent: str
    period: str  # "YYYY-MM"
    total_usd: float
    calls: int
    generated_at: str


def summarize_costs(agent: str, costs_path: Path | None = None, period: str | None = None) -> CostsSummary:
    """Sums `costs_path`'s entries for `agent` within `period` (a
    "YYYY-MM" string; defaults to the current month)."""
    costs_path = costs_path if costs_path is not None else _default_costs_path()
    period = period or datetime.now(UTC).strftime("%Y-%m")

    total = 0.0
    calls = 0
    if costs_path.exists():
        with open(costs_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                if row.get("agent") != agent:
                    continue
                row_period = datetime.fromtimestamp(row["ts"], tz=UTC).strftime("%Y-%m")
                if row_period != period:
                    continue
                total += row["cost_usd"]
                calls += 1

    return CostsSummary(
        agent=agent,
        period=period,
        total_usd=round(total, 6),
        calls=calls,
        generated_at=datetime.now(UTC).isoformat(),
    )


def publish_costs_summary(
    agent: str,
    *,
    costs_path: Path | None = None,
    period: str | None = None,
    publish_dir: Path | str | None = None,
) -> int:
    summary = summarize_costs(agent, costs_path=costs_path, period=period)
    base = (Path(publish_dir) if publish_dir is not None else default_publish_dir()) / agent
    return write_json(base / "costs-summary.json", asdict(summary))
