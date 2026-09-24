from __future__ import annotations

from agents_core.models import load_models


def test_default_models_load_without_override(tmp_path):
    models = load_models(path=tmp_path / "nonexistent.toml")
    assert "fast" in models.tiers
    assert "smart" in models.tiers
    fast_model = models.model_for_tier("fast")
    pricing = models.pricing_for(fast_model)
    assert pricing.input_per_mtok > 0
    assert pricing.output_per_mtok > 0


def test_override_merges_not_replaces(tmp_path):
    override = tmp_path / "models.toml"
    override.write_text(
        '[tiers]\nfast = "custom-fast-model"\n\n'
        '[pricing."custom-fast-model"]\ninput_per_mtok = 0.5\noutput_per_mtok = 2.5\n'
    )
    models = load_models(path=override)

    assert models.tiers["fast"] == "custom-fast-model"
    assert "smart" in models.tiers  # untouched default survives the merge
    assert models.pricing_for("custom-fast-model").input_per_mtok == 0.5


def test_unknown_tier_raises_key_error(tmp_path):
    models = load_models(path=tmp_path / "nonexistent.toml")
    try:
        models.model_for_tier("nope")
    except KeyError as exc:
        assert "nope" in str(exc)
    else:
        raise AssertionError("expected KeyError")
