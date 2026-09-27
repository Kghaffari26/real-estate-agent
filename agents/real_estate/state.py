"""Run state and the previous published output.

`State` (`<data dir>/real_estate/state.json`, committed back to the default
branch by agents-core's `run-agent.yml`) holds source versions and, for every
brief and investigation, the SHA-256 of the facts it was generated from
(SPEC_REAL_ESTATE.md §4).

The briefs and investigations themselves are reused from the *previous
published output* (`Previous`): since agents-core v0.2.0 the reusable workflow
restores the `data` branch into the publish dir before each run, so the last
`latest.json` and `metros/<slug>.json` are there in CI too. A narrative is
reused only when its facts hash in `State` matches *and* the previous output
still has it; otherwise it's regenerated.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from agents_core import settings


def state_path() -> Path:
    """Under the configured data dir (`AGENTS_CORE_DATA_DIR`, default `data/`)."""
    return settings.data_dir() / "real_estate" / "state.json"


@dataclass
class State:
    sources: dict[str, Any] = field(default_factory=dict)
    brief_hashes: dict[str, str] = field(default_factory=dict)
    investigation_hashes: dict[str, str] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path | None = None) -> State:
        path = path or state_path()
        if not path.exists():
            return cls()
        data = json.loads(path.read_text())
        return cls(
            sources=data.get("sources", {}),
            brief_hashes=data.get("brief_hashes", {}),
            investigation_hashes=data.get("investigation_hashes", {}),
        )

    def save(self, path: Path | None = None) -> None:
        path = path or state_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "sources": self.sources,
            "brief_hashes": self.brief_hashes,
            "investigation_hashes": self.investigation_hashes,
        }
        path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def hash_facts(facts: Any) -> str:
    """Stable hash of a facts dict (§7.2); `sort_keys=True` makes key order
    irrelevant so equivalent facts always hash the same."""
    canonical = json.dumps(facts, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def facts_changed(state: State, key: str, facts: Any) -> tuple[bool, str]:
    """Returns `(changed, new_hash)` for the given cache key (a metro slug,
    or `"national"`)."""
    new_hash = hash_facts(facts)
    return state.brief_hashes.get(key) != new_hash, new_hash


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


@dataclass
class Previous:
    """The previous run's published output, read from the publish dir (restored
    from the `data` branch in CI). Empty on a first run or a fresh local checkout."""

    root: Path

    @classmethod
    def load(cls) -> Previous:
        return cls(settings.publish_dir())

    def metro(self, slug: str) -> dict[str, Any] | None:
        return _read_json(self.root / "metros" / f"{slug}.json")

    def latest(self) -> dict[str, Any] | None:
        return _read_json(self.root / "latest.json")

    def brief(self, key: str) -> dict[str, Any] | None:
        """The published `brief` block for a metro slug, or `"national"`."""
        if key == "national":
            doc = self.latest()
            return (doc or {}).get("national", {}).get("brief")
        return (self.metro(key) or {}).get("brief")

    def investigation(self, slug: str) -> dict[str, Any] | None:
        return (self.metro(slug) or {}).get("investigation")


def reusable(
    state_hashes: dict[str, str], key: str, facts_hash: str, prior: dict[str, Any] | None
) -> dict[str, Any] | None:
    """`prior` if it was generated from `facts_hash`, else None."""
    if prior and state_hashes.get(key) == facts_hash:
        return prior
    return None
