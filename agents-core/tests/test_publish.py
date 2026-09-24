from __future__ import annotations

from datetime import date, timedelta

import pytest

from agents_core.publish import PublishSizeError, publish_index, publish_item, write_json


def test_write_json_enforces_max_kb(tmp_path):
    path = tmp_path / "out.json"
    with pytest.raises(PublishSizeError):
        write_json(path, {"x": "y" * 10000}, max_kb=0.1)
    assert not path.exists()


def test_write_json_writes_when_within_budget(tmp_path):
    path = tmp_path / "out.json"
    size = write_json(path, {"a": 1}, max_kb=10)
    assert path.exists()
    assert size > 0


def test_publish_index_writes_latest_and_history(tmp_path):
    publish_dir = tmp_path / "public-data"
    publish_index("demo", {"hello": "world"}, publish_dir=publish_dir)
    assert (publish_dir / "demo" / "latest.json").exists()
    history_files = list((publish_dir / "demo" / "history").glob("*.json"))
    assert len(history_files) == 1


def test_publish_index_trims_history(tmp_path):
    publish_dir = tmp_path / "public-data"
    for i in range(5):
        publish_index(
            "demo",
            {"i": i},
            publish_dir=publish_dir,
            keep_history=2,
            run_date=date(2026, 1, 1) + timedelta(days=i),
        )
    history_files = sorted((publish_dir / "demo" / "history").glob("*.json"))
    assert len(history_files) == 2
    assert history_files[-1].name == "2026-01-05.json"


def test_publish_item(tmp_path):
    publish_dir = tmp_path / "public-data"
    publish_item("demo", "austin-tx", {"a": 1}, publish_dir=publish_dir, subdir="metros")
    assert (publish_dir / "demo" / "metros" / "austin-tx.json").exists()


def test_publish_defaults_to_paths_publish_dir(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("AGENTS_CORE_PUBLISH_DIR", str(tmp_path / "public-data"))
    publish_index("demo", {"hello": "world"})
    assert (tmp_path / "public-data" / "demo" / "latest.json").exists()
