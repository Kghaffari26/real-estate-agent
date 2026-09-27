from __future__ import annotations

import json

from agents.real_estate.state import (
    Previous,
    State,
    facts_changed,
    hash_facts,
    reusable,
    state_path,
)

FACTS = {
    "median_sale_price": 412000,
    "median_sale_price_yoy": 0.03,
    "inventory_yoy": -0.05,
}


def test_hash_facts_is_stable_for_the_same_dict():
    assert hash_facts(FACTS) == hash_facts(dict(FACTS))


def test_hash_facts_is_independent_of_key_order():
    reordered = {
        "inventory_yoy": -0.05,
        "median_sale_price": 412000,
        "median_sale_price_yoy": 0.03,
    }
    assert hash_facts(FACTS) == hash_facts(reordered)


def test_hash_facts_changes_when_a_value_changes():
    changed = {**FACTS, "median_sale_price": 415000}
    assert hash_facts(FACTS) != hash_facts(changed)


def test_hash_facts_changes_when_a_key_is_added_or_removed():
    extra = {**FACTS, "new_key": 1}
    assert hash_facts(FACTS) != hash_facts(extra)


def test_facts_changed_true_against_a_fresh_empty_state():
    state = State()
    changed, new_hash = facts_changed(state, "houston-tx", FACTS)
    assert changed is True
    assert new_hash == hash_facts(FACTS)


def test_facts_changed_false_when_hash_already_stored():
    state = State()
    _, stored_hash = facts_changed(state, "houston-tx", FACTS)
    state.brief_hashes["houston-tx"] = stored_hash

    changed, new_hash = facts_changed(state, "houston-tx", FACTS)
    assert changed is False
    assert new_hash == stored_hash


def test_facts_changed_false_when_facts_identical_but_key_order_differs():
    state = State()
    _, stored_hash = facts_changed(state, "houston-tx", FACTS)
    state.brief_hashes["houston-tx"] = stored_hash

    reordered = {
        "inventory_yoy": -0.05,
        "median_sale_price": 412000,
        "median_sale_price_yoy": 0.03,
    }
    changed, _ = facts_changed(state, "houston-tx", reordered)
    assert changed is False


def test_facts_changed_true_when_facts_differ_from_stored_hash():
    state = State()
    _, stored_hash = facts_changed(state, "houston-tx", FACTS)
    state.brief_hashes["houston-tx"] = stored_hash

    changed_facts = {**FACTS, "median_sale_price": 420000}
    changed, new_hash = facts_changed(state, "houston-tx", changed_facts)
    assert changed is True
    assert new_hash != stored_hash


def test_facts_changed_is_scoped_per_key():
    state = State()
    state.brief_hashes["houston-tx"] = hash_facts(FACTS)

    # A different metro (cache key) with the same facts hasn't been cached
    # under ITS key yet, so it should report changed.
    changed, _ = facts_changed(state, "atlanta-ga", FACTS)
    assert changed is True


def test_state_save_and_load_round_trip(tmp_path):
    path = tmp_path / "state.json"
    state = State(sources={"redfin_metro": {"etag": "abc"}}, brief_hashes={"houston-tx": "deadbeef"})
    state.save(path)

    loaded = State.load(path)
    assert loaded.sources == {"redfin_metro": {"etag": "abc"}}
    assert loaded.brief_hashes == {"houston-tx": "deadbeef"}


def test_state_load_returns_empty_state_when_file_missing(tmp_path):
    path = tmp_path / "does_not_exist.json"
    loaded = State.load(path)
    assert loaded.sources == {}
    assert loaded.brief_hashes == {}


def test_state_save_creates_parent_directories(tmp_path):
    path = tmp_path / "nested" / "dir" / "state.json"
    State().save(path)
    assert path.exists()


def test_state_path_follows_the_configured_data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENTS_CORE_DATA_DIR", str(tmp_path / "elsewhere"))
    assert state_path() == tmp_path / "elsewhere" / "real_estate" / "state.json"
    State(brief_hashes={"x": "h"}).save()
    assert (tmp_path / "elsewhere" / "real_estate" / "state.json").exists()
    assert State.load().brief_hashes == {"x": "h"}


def test_previous_reads_briefs_and_investigations_from_the_publish_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENTS_CORE_PUBLISH_DIR", str(tmp_path / "pub"))
    (tmp_path / "pub" / "metros").mkdir(parents=True)
    (tmp_path / "pub" / "latest.json").write_text(json.dumps({"national": {"brief": {"text": "N"}}}))
    (tmp_path / "pub" / "metros" / "a.json").write_text(
        json.dumps({"brief": {"text": "A"}, "investigation": {"explanation": "why"}})
    )
    prev = Previous.load()
    assert prev.brief("national") == {"text": "N"}
    assert prev.brief("a") == {"text": "A"}
    assert prev.investigation("a") == {"explanation": "why"}
    assert prev.brief("missing") is None
    # reuse needs both the matching hash and the previous output
    assert reusable({"a": "h1"}, "a", "h1", prev.brief("a")) == {"text": "A"}
    assert reusable({"a": "h1"}, "a", "h2", prev.brief("a")) is None
    assert reusable({"a": "h1"}, "a", "h1", None) is None


def test_previous_is_empty_without_a_publish_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENTS_CORE_PUBLISH_DIR", str(tmp_path / "none"))
    assert Previous.load().brief("national") is None
    assert Previous.load().investigation("a") is None
