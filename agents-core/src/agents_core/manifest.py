"""Per-agent manifest entry, published alongside the index so a website
repo (or a combined dashboard in a single-repo setup) can assemble a
manifest across every agent without needing agent-specific knowledge.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from agents_core.paths import publish_dir as default_publish_dir
from agents_core.publish import write_json


class ManifestEntry(BaseModel):
    id: str
    route: str | None = None
    expected_interval_hours: int
    next_run_hint: str | None = None
    items_count: int | None = None
    status: Literal["ok", "partial", "failed"] = "ok"
    data_through: str | None = None
    last_run_at: datetime


def publish_manifest_entry(
    agent: str, entry: ManifestEntry, *, publish_dir: Path | str | None = None
) -> int:
    base = (Path(publish_dir) if publish_dir is not None else default_publish_dir()) / agent
    return write_json(base / "manifest-entry.json", entry.model_dump(mode="json"))
