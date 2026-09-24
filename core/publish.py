"""Publish validated JSON to `site/public/data/<agent>/`, with dated history."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

from pydantic import BaseModel

DEFAULT_SITE_DATA_DIR = Path("site/public/data")
DEFAULT_MAX_HISTORY = 52


class PublishSizeError(ValueError):
    """Raised when a published file exceeds its configured size budget."""


def _dump(model_or_dict: BaseModel | dict[str, Any]) -> dict[str, Any]:
    if isinstance(model_or_dict, BaseModel):
        return json.loads(model_or_dict.model_dump_json())
    return model_or_dict


def write_json(path: Path, data: dict[str, Any], max_kb: float | None = None) -> int:
    """Write `data` as JSON to `path`, returning its size in bytes.

    Raises `PublishSizeError` (without writing anything) if `max_kb` is set
    and exceeded.
    """
    text = json.dumps(data, separators=(",", ":"), default=str)
    size = len(text.encode("utf-8"))
    if max_kb is not None and size > max_kb * 1024:
        raise PublishSizeError(f"{path}: {size / 1024:.1f}KB exceeds the {max_kb}KB limit")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return size


def publish_index(
    agent: str,
    data: BaseModel | dict[str, Any],
    *,
    site_data_dir: Path | str = DEFAULT_SITE_DATA_DIR,
    max_kb: float | None = None,
    keep_history: int = DEFAULT_MAX_HISTORY,
    run_date: date | None = None,
) -> int:
    """Write `<agent>/latest.json` and append it to `<agent>/history/<date>.json`,
    trimming history to `keep_history` files. Returns the published size in bytes.
    """
    payload = _dump(data)
    agent_dir = Path(site_data_dir) / agent
    size = write_json(agent_dir / "latest.json", payload, max_kb=max_kb)

    run_date = run_date or date.today()
    history_dir = agent_dir / "history"
    write_json(history_dir / f"{run_date.isoformat()}.json", payload)
    _trim_history(history_dir, keep_history)
    return size


def publish_item(
    agent: str,
    slug: str,
    data: BaseModel | dict[str, Any],
    *,
    site_data_dir: Path | str = DEFAULT_SITE_DATA_DIR,
    subdir: str = "",
    max_kb: float | None = None,
) -> int:
    """Write a per-item file, e.g. `<agent>/metros/<slug>.json`."""
    payload = _dump(data)
    base = Path(site_data_dir) / agent
    if subdir:
        base = base / subdir
    return write_json(base / f"{slug}.json", payload, max_kb=max_kb)


def _trim_history(history_dir: Path, keep: int) -> None:
    if not history_dir.exists():
        return
    files = sorted(history_dir.glob("*.json"))
    excess = len(files) - keep
    for f in files[:excess]:
        f.unlink()
