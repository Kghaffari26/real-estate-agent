from __future__ import annotations

from agents.real_estate.config import Metro, Settings, load_metros, load_settings

METROS_TOML = """
[[metro]]
slug = "houston-tx"
name = "Houston, TX"
redfin_region = "Houston, TX metro area"
cbsa = "26420"
lat = 29.76
lon = -95.36
zillow_region_id = 394692

[[metro]]
slug = "no-optional-fields"
name = "No Optional, ZZ"
redfin_region = "No Optional, ZZ metro area"
"""

SETTINGS_TOML = """
[settings]
history_months = 24
use_permits = false
max_index_kb = 200

[flags]
inventory_surge_yoy = 0.30

[temperature]
min_components = 3
bands = [90, 70, 50, 30]
"""


def test_load_metros_parses_all_fields(tmp_path):
    path = tmp_path / "metros.toml"
    path.write_text(METROS_TOML)
    metros = load_metros(path=path)

    assert len(metros) == 2
    houston = metros[0]
    assert houston == Metro(
        slug="houston-tx",
        name="Houston, TX",
        redfin_region="Houston, TX metro area",
        cbsa="26420",
        lat=29.76,
        lon=-95.36,
        zillow_region_id=394692,
    )


def test_load_metros_defaults_optional_fields_to_none(tmp_path):
    path = tmp_path / "metros.toml"
    path.write_text(METROS_TOML)
    metros = load_metros(path=path)

    stub = metros[1]
    assert stub.cbsa is None
    assert stub.lat is None
    assert stub.lon is None
    assert stub.zillow_region_id is None


def test_load_settings_reads_overrides(tmp_path):
    path = tmp_path / "real_estate.toml"
    path.write_text(SETTINGS_TOML)
    settings = load_settings(path=path)

    assert settings.history_months == 24
    assert settings.use_permits is False
    assert settings.max_index_kb == 200
    assert settings.flags == {"inventory_surge_yoy": 0.30}
    assert settings.temperature_min_components == 3
    assert settings.temperature_bands == (90, 70, 50, 30)


def test_load_settings_defaults_when_file_mostly_empty(tmp_path):
    path = tmp_path / "real_estate.toml"
    path.write_text("[settings]\n")
    settings = load_settings(path=path)

    assert settings == Settings(flags={})


def test_load_settings_reads_real_config_file():
    # Sanity check against the actual repo config, so this test breaks
    # loudly if that file's shape ever changes incompatibly.
    settings = load_settings()
    assert settings.history_months == 36
    assert "inventory_surge_yoy" in settings.flags
