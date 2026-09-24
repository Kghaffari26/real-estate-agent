from __future__ import annotations

from datetime import UTC, datetime

from agents_core.schema import RunMeta


def run(*, dry_run: bool = False, apply: bool = False, extra_args: list[str] | None = None) -> RunMeta:
    return RunMeta(agent="dummy", started_at=datetime.now(UTC), status="ok", data_changed=not dry_run)
