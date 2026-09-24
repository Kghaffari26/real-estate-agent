"""Loads `config/models.toml` (tiers -> model id, and per-model pricing),
merging the package's shipped defaults with an agent repo's own
`config/models.toml` when one exists. The repo's file only needs to
override what it wants to change — anything it omits falls back to the
package default (see `agents_core/config/models.toml`).
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Any

DEFAULT_MODELS_PATH = Path("config/models.toml")


@dataclass(frozen=True)
class ModelPricing:
    input_per_mtok: float
    output_per_mtok: float
    batch_discount: float = 0.5


@dataclass(frozen=True)
class ModelsConfig:
    tiers: dict[str, str]
    pricing: dict[str, ModelPricing]

    def model_for_tier(self, tier: str) -> str:
        try:
            return self.tiers[tier]
        except KeyError:
            raise KeyError(f"no model configured for tier {tier!r}; known tiers: {sorted(self.tiers)}") from None

    def pricing_for(self, model: str) -> ModelPricing:
        try:
            return self.pricing[model]
        except KeyError:
            raise KeyError(f"no pricing configured for model {model!r}") from None


def _load_default_toml() -> dict[str, Any]:
    text = resources.files("agents_core.config").joinpath("models.toml").read_text()
    return tomllib.loads(text)


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def load_models(path: Path | str = DEFAULT_MODELS_PATH) -> ModelsConfig:
    merged = _load_default_toml()
    override_path = Path(path)
    if override_path.exists():
        merged = _deep_merge(merged, tomllib.loads(override_path.read_text()))

    tiers = dict(merged.get("tiers", {}))
    pricing = {model: ModelPricing(**cfg) for model, cfg in merged.get("pricing", {}).items()}
    return ModelsConfig(tiers=tiers, pricing=pricing)
