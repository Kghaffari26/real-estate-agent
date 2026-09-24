"""Models shared by every agent's published output."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class Citation(BaseModel):
    """A source attribution, attached to a brief or the sources list."""

    name: str
    url: str
    attribution: str | None = None


class RunMeta(BaseModel):
    """Bookkeeping written into every agent's `meta` block."""

    agent: str
    started_at: datetime
    finished_at: datetime | None = None
    cost_usd: float = 0.0
    status: Literal["ok", "partial", "failed"] = "ok"
    data_changed: bool = True
    stale: bool = False
    batch_fallback: bool = False
    warnings: list[str] = Field(default_factory=list)
