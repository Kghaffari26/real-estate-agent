from __future__ import annotations

from pathlib import Path

from agents_core import paths


def test_defaults(monkeypatch):
    monkeypatch.delenv("AGENTS_CORE_DATA_DIR", raising=False)
    monkeypatch.delenv("AGENTS_CORE_PUBLISH_DIR", raising=False)
    assert paths.data_dir() == Path("data")
    assert paths.publish_dir() == Path("public-data")


def test_env_override(monkeypatch):
    monkeypatch.setenv("AGENTS_CORE_DATA_DIR", "/tmp/custom-data")
    monkeypatch.setenv("AGENTS_CORE_PUBLISH_DIR", "/tmp/custom-publish")
    assert paths.data_dir() == Path("/tmp/custom-data")
    assert paths.publish_dir() == Path("/tmp/custom-publish")
