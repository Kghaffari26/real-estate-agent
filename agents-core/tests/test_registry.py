from __future__ import annotations

import sys
from importlib.metadata import EntryPoint
from pathlib import Path

import pytest

from agents_core import registry

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _fake_entry_points(*, group):
    assert group == registry.GROUP
    return [EntryPoint(name="dummy", value="dummy_agent:run", group=group)]


def test_discover_agents(monkeypatch):
    monkeypatch.setattr(registry, "entry_points", _fake_entry_points)
    assert registry.discover_agents() == {"dummy": "dummy_agent:run"}


def test_load_agent_not_found(monkeypatch):
    monkeypatch.setattr(registry, "entry_points", lambda group: [])
    with pytest.raises(registry.AgentNotFound):
        registry.load_agent("missing")


def test_load_agent_loads_callable(monkeypatch):
    sys.path.insert(0, str(FIXTURES_DIR))
    try:
        monkeypatch.setattr(registry, "entry_points", _fake_entry_points)
        fn = registry.load_agent("dummy")
        assert callable(fn)
        meta = fn(dry_run=True)
        assert meta.agent == "dummy"
        assert meta.status == "ok"
    finally:
        sys.path.remove(str(FIXTURES_DIR))
