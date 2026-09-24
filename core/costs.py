"""Per-run cost tracking and a spend guard.

Every LLM call an agent makes should go through `CostTracker.record`,
which appends a line to `data/costs.jsonl` and raises `BudgetExceeded`
once the running total for *this run* crosses `max_run_usd`.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_COSTS_PATH = Path("data/costs.jsonl")


class BudgetExceeded(RuntimeError):
    """Raised when a single run's LLM spend crosses its MAX_RUN_USD cap."""


@dataclass
class CostTracker:
    agent: str
    max_run_usd: float
    costs_path: Path = DEFAULT_COSTS_PATH
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
