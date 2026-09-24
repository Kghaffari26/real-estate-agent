from __future__ import annotations

import json
from datetime import UTC, datetime

from agents_core.manifest import ManifestEntry, publish_manifest_entry


def test_publish_manifest_entry(tmp_path):
    entry = ManifestEntry(
        id="demo",
        route="/demo",
        expected_interval_hours=24,
        items_count=5,
        last_run_at=datetime.now(UTC),
    )
    publish_dir = tmp_path / "public-data"
    publish_manifest_entry("demo", entry, publish_dir=publish_dir)

    path = publish_dir / "demo" / "manifest-entry.json"
    assert path.exists()
    data = json.loads(path.read_text())
    assert data["id"] == "demo"
    assert data["items_count"] == 5
    assert data["status"] == "ok"


def test_manifest_entry_defaults():
    entry = ManifestEntry(id="demo", expected_interval_hours=168, last_run_at=datetime.now(UTC))
    assert entry.route is None
    assert entry.items_count is None
    assert entry.status == "ok"
