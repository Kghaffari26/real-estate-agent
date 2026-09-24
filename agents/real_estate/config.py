"""Loads `config/metros.toml` and `config/real_estate.toml` into typed objects."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_METROS_PATH = Path("config/metros.toml")
DEFAULT_SETTINGS_PATH = Path("config/real_estate.toml")


@dataclass(frozen=True)
class Metro:
    slug: str
    name: str
    redfin_region: str
    cbsa: str | None
    lat: float | None
    lon: float | None
    zillow_region_id: int | None = None


@dataclass(frozen=True)
class Settings:
    history_months: int = 36
    use_permits: bool = True
    use_acs_income: bool = True
    batch_poll_timeout_min: int = 40
    max_index_kb: float = 150
    max_metro_kb: float = 40
    flags: dict[str, float] = field(default_factory=dict)
    temperature_min_components: int = 4
    temperature_bands: tuple[int, int, int, int] = (80, 60, 40, 20)


def load_metros(path: Path | str = DEFAULT_METROS_PATH) -> list[Metro]:
    data = tomllib.loads(Path(path).read_text())
    metros = []
    for entry in data.get("metro", []):
        metros.append(
            Metro(
                slug=entry["slug"],
                name=entry["name"],
                redfin_region=entry["redfin_region"],
                cbsa=str(entry["cbsa"]) if entry.get("cbsa") else None,
                lat=float(entry["lat"]) if entry.get("lat") is not None else None,
                lon=float(entry["lon"]) if entry.get("lon") is not None else None,
                zillow_region_id=entry.get("zillow_region_id"),
            )
        )
    return metros


def load_settings(path: Path | str = DEFAULT_SETTINGS_PATH) -> Settings:
    data = tomllib.loads(Path(path).read_text())
    settings = data.get("settings", {})
    flags = data.get("flags", {})
    temperature = data.get("temperature", {})
    bands = temperature.get("bands", [80, 60, 40, 20])
    return Settings(
        history_months=settings.get("history_months", 36),
        use_permits=settings.get("use_permits", True),
        use_acs_income=settings.get("use_acs_income", True),
        batch_poll_timeout_min=settings.get("batch_poll_timeout_min", 40),
        max_index_kb=settings.get("max_index_kb", 150),
        max_metro_kb=settings.get("max_metro_kb", 40),
        flags=dict(flags),
        temperature_min_components=temperature.get("min_components", 4),
        temperature_bands=tuple(bands),
    )
