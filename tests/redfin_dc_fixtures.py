"""Builders for Redfin Data Center CSVs (the 2026 format) used by the fetcher tests.

Shapes copied from the live files on 2026-09-28: quoted headers, "NA" for nulls,
percents as percents, value/MOM/YOY triplets, and no REGION ID in price drops.
"""

from __future__ import annotations

HOUSING_METRICS = [
    ("HOMES SOLD", "(%)"),
    ("MEDIAN SALE PRICE NSA ($)", "(%)"),
    ("MEDIAN DAYS ON MARKET (DAYS)", "(DAYS)"),
    ("AVERAGE SALE TO LIST RATIO (%)", "(PPTS)"),
    ("SHARE SOLD ABOVE ORIGINAL LIST (%)", "(PPTS)"),
    ("NEW LISTINGS", "(%)"),
    ("ACTIVE LISTINGS", "(%)"),
    ("INVENTORY", "(%)"),
    ("PENDING SALES", "(%)"),
    ("MEDIAN NEW LISTING PRICE ($)", "(%)"),
    ("MEDIAN NEW LISTING PRICE PER SQ.FT. ($)", "(%)"),
    ("MEDIAN SALE PRICE PER SQ.FT. ($)", "(%)"),
    ("MONTHS OF SUPPLY", "(%)"),
    ("PERCENT OFF MARKET IN TWO WEEKS (%)", "(PPTS)"),
]
PRICE_DROP_METRICS = [
    ("PRICE DROPS", "(%)"),
    ("AVERAGE SIZE OF PRICE DROP (%)", "(PPTS)"),
    ("PERCENT ACTIVE WITH PRICE DROPS (%)", "(PPTS)"),
    ("HOMES SOLD WITH PRICE DROPS", "(%)"),
]
KEY = ["LAST UPDATED", "FREQUENCY", "PERIOD BEGIN", "PERIOD END"]


def _triplet_header(metrics: list[tuple[str, str]]) -> list[str]:
    out = []
    for name, unit in metrics:
        stem = name.rsplit(" (", 1)[0] if name.endswith(")") else name
        out += [name, f"{stem} MOM {unit}", f"{stem} YOY {unit}"]
    return out


def housing_header() -> list[str]:
    return [*KEY, "REGION ID", "REGION TYPE", "REGION NAME", *_triplet_header(HOUSING_METRICS)]


def price_drops_header() -> list[str]:
    return [*KEY, "REGION TYPE", "REGION NAME", *_triplet_header(PRICE_DROP_METRICS)]


def _csv(header: list[str], rows: list[list[object]]) -> bytes:
    def cell(v: object) -> str:
        if v is None:
            return "NA"
        return f'"{v}"' if isinstance(v, str) else str(v)

    lines = [",".join(f'"{h}"' for h in header)] + [",".join(cell(v) for v in r) for r in rows]
    return ("\n".join(lines) + "\n").encode()


def housing_csv(regions: list[tuple[str, str | None, str, dict[str, float | None]]], month_ends: list) -> bytes:
    """`regions`: (region name, region id or None, region type, per-month overrides
    keyed by column name whose values are callables of the month index or constants)."""
    header = housing_header()
    rows = []
    for name, rid, rtype, values in regions:
        for i, end in enumerate(month_ends):
            row: list[object] = ["2026-09-03", "Monthly", end.replace(day=1).isoformat(), end.isoformat(), rid, rtype, name]
            for metric, _ in HOUSING_METRICS:
                v = values.get(metric)
                v = v(i) if callable(v) else v
                row += [v, 0.5, 1.0]  # MOM/YOY columns are Redfin's; the fetcher ignores them
            rows.append(row)
    return _csv(header, rows)


def price_drops_csv(regions: list[tuple[str, str, object]], month_ends: list) -> bytes:
    """`regions`: (region name, region type, PERCENT ACTIVE WITH PRICE DROPS (%) value or callable)."""
    rows = []
    for name, rtype, pct in regions:
        for i, end in enumerate(month_ends):
            v = pct(i) if callable(pct) else pct
            rows.append(["2026-09-03", "Monthly", end.replace(day=1).isoformat(), end.isoformat(), rtype, name, 100, 1.0, 2.0, 4.0, 0.1, 0.2, v, 0.1, 0.5, 40, 1.0, 2.0])
    return _csv(price_drops_header(), rows)


def default_values(base_price: float) -> dict[str, object]:
    return {
        "MEDIAN SALE PRICE NSA ($)": lambda i: round(base_price * (1 + 0.004 * i)),
        "HOMES SOLD": lambda i: 1000 + i,
        "NEW LISTINGS": 1500,
        "ACTIVE LISTINGS": 5000,
        "INVENTORY": lambda i: 4000 + 40 * i,
        "PENDING SALES": 900,
        "MONTHS OF SUPPLY": 3.2,
        "MEDIAN DAYS ON MARKET (DAYS)": lambda i: 30 + i % 5,
        "AVERAGE SALE TO LIST RATIO (%)": 98.0,
        "SHARE SOLD ABOVE ORIGINAL LIST (%)": 30.0,
        "PERCENT OFF MARKET IN TWO WEEKS (%)": 20.0,
        "MEDIAN NEW LISTING PRICE ($)": 400000,
        "MEDIAN NEW LISTING PRICE PER SQ.FT. ($)": 200.0,
        "MEDIAN SALE PRICE PER SQ.FT. ($)": 199.0,
    }
