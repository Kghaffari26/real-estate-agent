"""v3 §4.2 regions: a county-scale market down to ZIP and city (Orange County first).

Pure. Inputs: Redfin's ZIP rows for the region's metros (rolling 3-month windows,
`fetch_redfin.fetch_zips`) and the committed geometry's ZIP → city assignment and
centroids (`scripts/build_region_geometry.py`). Output: `regions/<slug>.json`.

- **ZIPs**: Redfin's levels for the latest month (percents → ratios, rounded), changes
  computed here with `compute.compute_metric_series` and each metric's registry
  `change_kind` (ratio for levels, pp for shares, a difference for days and months),
  exactly as for metros; 36 months of the main series; ranks within the region.
- **Cities and the region summary**: each month aggregated from their ZIPs, sums for
  counts (homes sold, new listings, inventory) and **homes-sold-weighted means** of the
  ZIP medians and ratios for the rest (labelled as weighted on the site: there are no
  sale-level records), then changed with the same rule. A month with no ZIP sales has
  no weighted value.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from agents.real_estate import compute
from agents.real_estate import metrics as metric_registry
from agents.real_estate.config import RegionConfig
from agents.real_estate.schema import (
    RegionArea,
    RegionGeometry,
    RegionMetric,
    RegionOutput,
    RegionRef,
)
from agents.real_estate.timeline import month_axis, month_end

# Output key -> (Redfin ZIP column, is a percent to convert to a ratio).
REGION_METRICS: dict[str, tuple[str, bool]] = {
    "median_sale_price": ("MEDIAN SALE PRICE NSA ($)", False),
    "homes_sold": ("HOMES SOLD", False),
    "new_listings": ("NEW LISTINGS", False),
    "inventory": ("INVENTORY", False),
    "median_dom": ("MEDIAN DAYS ON MARKET (DAYS)", False),
    "avg_sale_to_list": ("AVERAGE SALE TO LIST RATIO (%)", True),
    "sold_above_list": ("SHARE SOLD ABOVE ORIGINAL LIST (%)", True),
    "off_market_in_two_weeks": ("PERCENT OFF MARKET IN TWO WEEKS (%)", True),
    "months_of_supply": ("MONTHS OF SUPPLY", False),
}
FETCH_COLUMNS: dict[str, str] = {k: col for k, (col, _) in REGION_METRICS.items()}
SUMMED = ("homes_sold", "new_listings", "inventory")
SERIES_METRICS = ("median_sale_price", "homes_sold", "inventory", "median_dom")
DECIMALS: dict[str, int] = {"avg_sale_to_list": 4, "sold_above_list": 4, "off_market_in_two_weeks": 4, "months_of_supply": 1}
HISTORY_MONTHS = 36


@dataclass(frozen=True)
class GeoInfo:
    """From the committed geometry: ZIP → (city, lat, lon) and city → (geoid, lat, lon)."""

    zips: dict[str, tuple[str | None, float | None, float | None]]
    cities: dict[str, tuple[str, float | None, float | None]]


def load_geometry(path: Path | str) -> RegionGeometry | None:
    p = Path(path)
    if not p.exists():
        return None
    return RegionGeometry.model_validate_json(p.read_text(encoding="utf8"))


def geo_info(geometry: RegionGeometry | None) -> GeoInfo:
    zips: dict[str, tuple[str | None, float | None, float | None]] = {}
    cities: dict[str, tuple[str, float | None, float | None]] = {}
    for f in (geometry.features if geometry else []):
        p = f.get("properties", {})
        if p.get("kind") == "zip":
            zips[str(p["id"])] = (p.get("city"), p.get("lat"), p.get("lon"))
        elif p.get("kind") == "city":
            cities[str(p["name"])] = (str(p["id"]), p.get("lat"), p.get("lon"))
    return GeoInfo(zips, cities)


def _num(v: Any, percent: bool) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f:
        return None
    return f / 100 if percent else f


def _round(key: str, v: float | None) -> float | int | None:
    if v is None:
        return None
    d = DECIMALS.get(key, 0)
    return int(round(v)) if d == 0 else round(v, d)


def _change_round(key: str, v: float | None) -> float | None:
    return None if v is None else round(v, 4 if metric_registry.get(key).change_kind != "diff" else 1)


def aggregate(values_by_zip: dict[str, dict[str, float | None]]) -> dict[str, float | None]:
    """One month of several ZIPs → one area: sums for counts, homes-sold-weighted means for the rest."""
    out: dict[str, float | None] = {}
    for key in REGION_METRICS:
        present = [(v[key], v.get("homes_sold")) for v in values_by_zip.values() if v.get(key) is not None]
        if key in SUMMED:
            out[key] = sum(x for x, _ in present) if present else None
            continue
        weighted = [(x, w) for x, w in present if w and w > 0]
        total = sum(w for _, w in weighted)
        out[key] = sum(x * w for x, w in weighted) / total if total else None
    return out


def _area(
    *,
    area_id: str,
    name: str,
    kind: str,
    monthly: dict[date, dict[str, float | None]],
    dates: list[date],
    through: date,
    lat: float | None,
    lon: float | None,
    city: str | None = None,
    zips: list[str] | None = None,
) -> RegionArea:
    latest: dict[str, RegionMetric] = {}
    for key in REGION_METRICS:
        pairs = [(d, row.get(key)) for d, row in monthly.items()]
        ch = compute.compute_metric_series(pairs, metric_registry.get(key).change_kind, as_of=through)
        latest[key] = RegionMetric(value=_round(key, ch.value), yoy=_change_round(key, ch.yoy))
    series = {key: [_round(key, monthly.get(d, {}).get(key)) for d in dates] for key in SERIES_METRICS}
    return RegionArea(id=area_id, name=name, kind=kind, city=city, zips=zips or [], lat=lat, lon=lon, latest=latest, series=series)


def _rank(areas: list[RegionArea]) -> None:
    """1 = highest price, fastest price growth, fastest sales (fewest days on market)."""

    def assign(get: Callable[[RegionArea], float | None], label: str, descending: bool) -> None:
        present = sorted((a for a in areas if get(a) is not None), key=lambda a: get(a), reverse=descending)  # type: ignore[arg-type, return-value]
        for i, a in enumerate(present, 1):
            a.ranks[label] = i

    assign(lambda a: a.latest["median_sale_price"].value, "median_sale_price", True)
    assign(lambda a: a.latest["median_sale_price"].yoy, "median_sale_price_yoy", True)
    assign(lambda a: a.latest["median_dom"].value, "median_dom", False)


def build_region(
    rows: Iterable[dict[str, Any]], region: RegionConfig, metro_regions: set[str], geo: GeoInfo, through: date
) -> RegionOutput | None:
    """`rows`: dicts with `metro` (Redfin metro name), `zip`, `period_end` and the
    `REGION_METRICS` keys (raw Redfin values; percents converted here)."""
    start = month_end(date(through.year - 3, through.month, 1))
    history = month_axis(date(start.year - 1, start.month, 1), through)  # a year before the axis, for YoY
    keep = set(history)
    by_zip: dict[str, dict[date, dict[str, float | None]]] = {}
    for r in rows:
        if r.get("metro") not in metro_regions or not r.get("zip") or r.get("period_end") is None:
            continue
        d = month_end(r["period_end"])
        if d not in keep:
            continue
        by_zip.setdefault(str(r["zip"]), {})[d] = {k: _num(r.get(k), pct) for k, (_, pct) in REGION_METRICS.items()}
    # ZIPs in the region: those reporting in the latest month.
    current = sorted(z for z, m in by_zip.items() if through in m)
    if not current:
        return None
    dates = history[-HISTORY_MONTHS:]
    zips: list[RegionArea] = []
    for z in current:
        city, lat, lon = geo.zips.get(z, (None, None, None))
        zips.append(_area(area_id=z, name=z, kind="zip", monthly=by_zip[z], dates=dates, through=through, lat=lat, lon=lon, city=city))
    _rank(zips)

    members: dict[str, list[str]] = {}
    for z in current:
        city = geo.zips.get(z, (None, None, None))[0]
        if city:
            members.setdefault(city, []).append(z)

    def rollup(zs: list[str]) -> dict[date, dict[str, float | None]]:
        return {d: aggregate({z: by_zip[z][d] for z in zs if d in by_zip[z]}) for d in history}

    cities: list[RegionArea] = []
    for name, zs in sorted(members.items()):
        geoid, lat, lon = geo.cities.get(name, (name, None, None))
        cities.append(_area(area_id=geoid, name=name, kind="city", monthly=rollup(zs), dates=dates, through=through, lat=lat, lon=lon, zips=sorted(zs)))
    _rank(cities)
    summary = _area(area_id=region.slug, name=region.name, kind="region", monthly=rollup(current), dates=dates, through=through, lat=None, lon=None, zips=current)
    return RegionOutput(
        slug=region.slug,
        name=region.name,
        metros=list(region.metros),
        data_through=through,
        dates=dates,
        summary=summary,
        cities=sorted(cities, key=lambda a: -(a.latest["homes_sold"].value or 0)),
        zips=sorted(zips, key=lambda a: a.id),
    )


def fit(out: RegionOutput, size_of: Callable[[RegionOutput], int], max_bytes: int) -> tuple[RegionOutput | None, list[str]]:
    size = size_of(out)
    if size > max_bytes:
        return None, [f"regions/{out.slug}.json is {size} bytes (limit {max_bytes}); not published this run"]
    return out, []


def ref(out: RegionOutput, geometry_published: bool) -> RegionRef:
    return RegionRef(
        slug=out.slug,
        name=out.name,
        path=f"regions/{out.slug}.json",
        geometry=f"regions/{out.slug}.geo.json" if geometry_published else None,
        zips=len(out.zips),
        cities=len(out.cities),
        through=out.data_through,
    )


def geometry_size(geometry: RegionGeometry) -> int:
    return len(json.dumps(geometry.model_dump(mode="json"), separators=(",", ":")).encode())
