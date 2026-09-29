"""§6.7 finer geography: the counties in each tracked metro, for the dashboard's
radius search. Pure.

Rows come from Redfin's monthly county file (its `METRO` column names the parent
metro, exactly our `redfin_region`); centroids come from the committed
`config/county_centroids.csv` (Census Gazetteer, `scripts/build_county_centroids.py`).
Values are Redfin levels for the metro's latest month, rounded to whole numbers;
YoY is computed here with §5.1's rule (value / the same county 12 months earlier - 1).
Counties are ordered by homes sold, most first.
"""

from __future__ import annotations

import csv
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from agents.real_estate.config import Metro
from agents.real_estate.schema import AreaOut, AreaRef, AreasOutput
from agents.real_estate.timeline import month_end

DEFAULT_CENTROIDS_PATH = Path("config/county_centroids.csv")
# Output key -> Redfin county column.
AREA_COLUMNS: dict[str, str] = {
    "median_sale_price": "MEDIAN SALE PRICE NSA ($)",
    "inventory": "INVENTORY",
    "homes_sold": "HOMES SOLD",
}


@dataclass(frozen=True)
class Centroid:
    geoid: str
    lat: float
    lon: float


def load_centroids(path: Path | str = DEFAULT_CENTROIDS_PATH) -> dict[str, Centroid]:
    """Redfin county name ("Bergen County, NJ") -> Gazetteer GEOID and internal point."""
    p = Path(path)
    if not p.exists():
        return {}
    with p.open(encoding="utf8", newline="") as f:
        rows = csv.DictReader(line for line in f if not line.startswith("#"))
        return {r["name"]: Centroid(r["geoid"], float(r["lat"]), float(r["lon"])) for r in rows}


def _int(v: Any) -> int | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else int(round(f))


def _yoy(now: int | None, then: int | None) -> float | None:
    return round(now / then - 1, 4) if now is not None and then else None


def build_areas(
    rows: Iterable[dict[str, Any]], metros: list[Metro], centroids: dict[str, Centroid], through: date
) -> dict[str, AreasOutput]:
    """`rows`: dicts with `metro`, `region` (county), `period_end` and the `AREA_COLUMNS` keys."""
    slug_of = {m.redfin_region: m.slug for m in metros}
    latest, year_ago = month_end(through), month_end(date(through.year - 1, through.month, 1))
    now: dict[str, dict[str, dict[str, Any]]] = {}
    then: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        slug, end, name = slug_of.get(row.get("metro")), row.get("period_end"), row.get("region")
        if slug is None or end is None or not name:
            continue
        end = month_end(end)
        if end == latest:
            now.setdefault(slug, {})[name] = row
        elif end == year_ago:
            then[(slug, name)] = row
    out: dict[str, AreasOutput] = {}
    for slug, counties in now.items():
        areas: list[AreaOut] = []
        for name, row in counties.items():
            prior = then.get((slug, name), {})
            c = centroids.get(name)
            values = {k: _int(row.get(k)) for k in AREA_COLUMNS}
            areas.append(
                AreaOut(
                    name=name,
                    geoid=c.geoid if c else None,
                    lat=c.lat if c else None,
                    lon=c.lon if c else None,
                    **values,
                    **{f"{k}_yoy": _yoy(values[k], _int(prior.get(k))) for k in AREA_COLUMNS},
                )
            )
        areas.sort(key=lambda a: (-(a.homes_sold or 0), a.name))
        out[slug] = AreasOutput(slug=slug, data_through=latest, areas=areas)
    return out


def fit(
    areas: dict[str, AreasOutput], size_of: Callable[[AreasOutput], int], max_bytes: int
) -> tuple[dict[str, AreasOutput], list[str]]:
    """Drop (with a warning) any metro's file over budget; counties are never trimmed silently."""
    kept: dict[str, AreasOutput] = {}
    warnings: list[str] = []
    for slug, a in areas.items():
        size = size_of(a)
        if size > max_bytes:
            warnings.append(f"areas/{slug}.json is {size} bytes (limit {max_bytes}); not published this run")
        else:
            kept[slug] = a
    return kept, warnings


def refs(areas: dict[str, AreasOutput]) -> list[AreaRef]:
    return [AreaRef(slug=slug, path=f"areas/{slug}.json", count=len(a.areas)) for slug, a in sorted(areas.items())]
