from __future__ import annotations

from agents.real_estate.movers import compute_movers


def _entry(slug, name, homes_sold_12m, **metrics):
    return {"slug": slug, "name": name, "homes_sold_12m": homes_sold_12m, **metrics}


def test_compute_movers_returns_all_five_lists():
    entries = [_entry("a", "A", 100, median_sale_price_yoy=0.05)]
    movers = compute_movers(entries)
    assert set(movers.keys()) == {
        "price_gains",
        "price_declines",
        "inventory_growth",
        "temperature_top",
        "temperature_bottom",
    }


def test_price_gains_sorted_descending():
    entries = [
        _entry("a", "A", 100, median_sale_price_yoy=0.02),
        _entry("b", "B", 100, median_sale_price_yoy=0.10),
        _entry("c", "C", 100, median_sale_price_yoy=0.05),
    ]
    top = compute_movers(entries, n=5)["price_gains"]
    assert [e["slug"] for e in top] == ["b", "c", "a"]


def test_price_declines_sorted_ascending():
    entries = [
        _entry("a", "A", 100, median_sale_price_yoy=-0.02),
        _entry("b", "B", 100, median_sale_price_yoy=-0.10),
        _entry("c", "C", 100, median_sale_price_yoy=0.01),
    ]
    bottom = compute_movers(entries, n=5)["price_declines"]
    assert [e["slug"] for e in bottom] == ["b", "a", "c"]


def test_null_values_are_excluded_from_a_list():
    entries = [
        _entry("a", "A", 100, median_sale_price_yoy=0.05),
        _entry("b", "B", 200, median_sale_price_yoy=None),
        _entry("c", "C", 300),  # key entirely missing
    ]
    gains = compute_movers(entries)["price_gains"]
    assert [e["slug"] for e in gains] == ["a"]


def test_null_values_excluded_do_not_affect_other_metrics_lists():
    entries = [
        _entry("a", "A", 100, median_sale_price_yoy=None, inventory_yoy=0.4),
        _entry("b", "B", 100, median_sale_price_yoy=0.05, inventory_yoy=None),
    ]
    movers = compute_movers(entries)
    assert [e["slug"] for e in movers["price_gains"]] == ["b"]
    assert [e["slug"] for e in movers["inventory_growth"]] == ["a"]


def test_tie_break_larger_market_wins_on_descending_sort():
    entries = [
        _entry("small", "Small", 100, median_sale_price_yoy=0.05),
        _entry("large", "Large", 999, median_sale_price_yoy=0.05),
    ]
    gains = compute_movers(entries)["price_gains"]
    assert [e["slug"] for e in gains] == ["large", "small"]


def test_tie_break_larger_market_wins_on_ascending_sort_too():
    # Direction is reversed (ascending, most negative first) but the
    # larger market should still win the tie.
    entries = [
        _entry("small", "Small", 100, median_sale_price_yoy=-0.05),
        _entry("large", "Large", 999, median_sale_price_yoy=-0.05),
    ]
    declines = compute_movers(entries)["price_declines"]
    assert [e["slug"] for e in declines] == ["large", "small"]


def test_tie_break_treats_missing_homes_sold_as_zero():
    entries = [
        _entry("has-size", "HasSize", 50, temperature_score=70),
        {"slug": "no-size", "name": "NoSize", "temperature_score": 70},
    ]
    top = compute_movers(entries)["temperature_top"]
    assert [e["slug"] for e in top] == ["has-size", "no-size"]


def test_compute_movers_respects_n_limit():
    entries = [_entry(str(i), str(i), 100, median_sale_price_yoy=float(i)) for i in range(10)]
    top = compute_movers(entries, n=3)["price_gains"]
    assert len(top) == 3
    assert [e["slug"] for e in top] == ["9", "8", "7"]


def test_temperature_top_and_bottom_are_independent_orderings():
    entries = [
        _entry("hot", "Hot", 100, temperature_score=90),
        _entry("cold", "Cold", 100, temperature_score=10),
        _entry("mid", "Mid", 100, temperature_score=50),
    ]
    movers = compute_movers(entries)
    assert [e["slug"] for e in movers["temperature_top"]] == ["hot", "mid", "cold"]
    assert [e["slug"] for e in movers["temperature_bottom"]] == ["cold", "mid", "hot"]


def test_compute_movers_empty_entries():
    movers = compute_movers([])
    for lst in movers.values():
        assert lst == []
