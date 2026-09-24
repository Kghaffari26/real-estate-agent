"""Configurable data and publish directories, shared by every module in
this package. An agent repo can override either via environment variable
(so CI can point them elsewhere without code changes) or by passing an
explicit path to whichever function needs it — nothing in this package
assumes a `site/public/data`-shaped layout.
"""

from __future__ import annotations

import os
from pathlib import Path

DEFAULT_DATA_DIR = Path("data")
DEFAULT_PUBLISH_DIR = Path("public-data")


def data_dir() -> Path:
    return Path(os.environ.get("AGENTS_CORE_DATA_DIR", DEFAULT_DATA_DIR))


def publish_dir() -> Path:
    return Path(os.environ.get("AGENTS_CORE_PUBLISH_DIR", DEFAULT_PUBLISH_DIR))
