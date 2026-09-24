"""Top/bottom mover lists across tracked metros (SPEC_REAL_ESTATE.md §5.5)."""

from __future__ import annotations

from typing import Any


def _top_n(
    entries: list[dict[str, Any]],
    value_key: str,
    *,
    n: int = 5,
    descending: bool = True,
    homes_sold_key: str = "homes_sold_12m",
) -> list[dict[str, Any]]:
    """Excludes entries where `value_key` is null. Ties break toward the
    larger market (higher `homes_sold_key`), regardless of sort direction."""
    usable = [e for e in entries if e.get(value_key) is not None]

    def sort_key(e: dict[str, Any]) -> tuple[float, float]:
        val = e[value_key]
        return (-val if descending else val, -(e.get(homes_sold_key) or 0))

    usable.sort(key=sort_key)
    return usable[:n]


def compute_movers(entries: list[dict[str, Any]], n: int = 5) -> dict[str, list[dict[str, Any]]]:
    """`entries`: one dict per metro with at least `slug`, `name`,
    `homes_sold_12m`, and whichever of `median_sale_price_yoy`,
    `inventory_yoy`, `temperature_score` are available."""
    return {
        "price_gains": _top_n(entries, "median_sale_price_yoy", n=n, descending=True),
        "price_declines": _top_n(entries, "median_sale_price_yoy", n=n, descending=False),
        "inventory_growth": _top_n(entries, "inventory_yoy", n=n, descending=True),
        "temperature_top": _top_n(entries, "temperature_score", n=n, descending=True),
        "temperature_bottom": _top_n(entries, "temperature_score", n=n, descending=False),
    }
