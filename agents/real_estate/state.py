"""Run state: source versions (etags/last-modified/data_through) and each
metro's last-used facts hash, so unchanged inputs skip both re-fetching
(handled by `core.http`'s own conditional-GET cache) and re-generating
briefs (SPEC_REAL_ESTATE.md §4).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

STATE_PATH = Path("data/real_estate/state.json")


@dataclass
class State:
    sources: dict[str, Any] = field(default_factory=dict)
    brief_hashes: dict[str, str] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path = STATE_PATH) -> State:
        if not path.exists():
            return cls()
        data = json.loads(path.read_text())
        return cls(sources=data.get("sources", {}), brief_hashes=data.get("brief_hashes", {}))

    def save(self, path: Path = STATE_PATH) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"sources": self.sources, "brief_hashes": self.brief_hashes}, indent=2, sort_keys=True)
        )


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
