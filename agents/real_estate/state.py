"""Run state: source versions (etags/last-modified/data_through), each
metro's last-used facts hash, and the briefs themselves, so unchanged inputs
skip both re-fetching (`agents/real_estate/download.py`'s conditional GET)
and re-generating briefs (SPEC_REAL_ESTATE.md §4).

Both files live under `data/real_estate/`, which agents-core's `run-agent.yml`
commits back to the default branch after every run. The brief cache is kept
there rather than read back from the published `metros/<slug>.json` because a
fresh CI checkout doesn't have `public-data/` (it lives on the `data` branch),
so a hash match alone would have nothing to reuse.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

STATE_PATH = Path("data/real_estate/state.json")
BRIEFS_PATH = Path("data/real_estate/briefs.json")


@dataclass
class State:
    sources: dict[str, Any] = field(default_factory=dict)
    brief_hashes: dict[str, str] = field(default_factory=dict)
    # The last published run's id, warnings (SPEC §10's degraded sources, stale
    # metros) and whether the metro batch fell back to synchronous calls.
    # agents-core's shared RunMeta has no field for either, so they're kept here.
    last_run: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path = STATE_PATH) -> State:
        if not path.exists():
            return cls()
        data = json.loads(path.read_text())
        return cls(
            sources=data.get("sources", {}),
            brief_hashes=data.get("brief_hashes", {}),
            last_run=data.get("last_run", {}),
        )

    def save(self, path: Path = STATE_PATH) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"sources": self.sources, "brief_hashes": self.brief_hashes, "last_run": self.last_run}
        path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def hash_facts(facts: dict[str, Any]) -> str:
    """Stable hash of a facts dict (§7.2); `sort_keys=True` makes key order
    irrelevant so equivalent facts always hash the same."""
    canonical = json.dumps(facts, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def facts_changed(state: State, key: str, facts: dict[str, Any]) -> tuple[bool, str]:
    """Returns `(changed, new_hash)` for the given cache key (a metro slug,
    or `"national"`)."""
    new_hash = hash_facts(facts)
    return state.brief_hashes.get(key) != new_hash, new_hash


@dataclass
class BriefCache:
    """`{key: {"hash": facts hash, "brief": published Brief dict}}`, keyed like
    `State.brief_hashes` (a metro slug, or `"national"`)."""

    entries: dict[str, dict[str, Any]] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path = BRIEFS_PATH) -> BriefCache:
        if not path.exists():
            return cls()
        try:
            return cls(entries=json.loads(path.read_text()))
        except json.JSONDecodeError:
            return cls()

    def save(self, path: Path = BRIEFS_PATH) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.entries, indent=1, sort_keys=True) + "\n")

    def get(self, key: str, facts_hash: str) -> dict[str, Any] | None:
        """The cached brief for `key`, only if it was generated from `facts_hash`."""
        entry = self.entries.get(key)
        if entry and entry.get("hash") == facts_hash:
            return entry.get("brief")
        return None

    def put(self, key: str, facts_hash: str, brief: dict[str, Any]) -> None:
        self.entries[key] = {"hash": facts_hash, "brief": brief}
