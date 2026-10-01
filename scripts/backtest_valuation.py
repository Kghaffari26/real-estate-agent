"""Backtest the comp-based valuation on closed sales (SPEC_LISTING_PREP.md §5.2, P3/P7).

    uv run python scripts/backtest_valuation.py closed_sales.csv [--json out.json]

Each sale is predicted from the sales that closed before it (agents/listing_prep/valuation.py,
`backtest`), and the result is scored by price band: the share of actual prices inside
the predicted range (an interquartile range, so about half is the honest expectation)
and the median absolute error of the midpoint. The report publishes this table once the
MLS feed is live.

The CSV (one row per closed sale; a CRMLS export maps onto it in P7):

    id,close_date,price,sqft,beds,baths,year_built,property_type,lat,lon,pool,garage_spaces

`close_date` is YYYY-MM-DD; `property_type` uses the Desk's values (single_family, condo,
townhouse, multi_family, manufactured); `pool` is true/false; `garage_spaces` may be blank.
The raw file stays out of the repository (MLS data is licensed); only the table is kept.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import asdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.listing_prep.valuation import Home, Sale, backtest  # noqa: E402

COLUMNS = ("id", "close_date", "price", "sqft", "beds", "baths", "year_built", "property_type", "lat", "lon", "pool", "garage_spaces")


def read_sales(path: Path) -> list[Sale]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        missing = [c for c in COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise SystemExit(f"{path}: missing columns {', '.join(missing)}")
        out = []
        for i, r in enumerate(reader, 2):
            try:
                home = Home(
                    sqft=int(float(r["sqft"])),
                    beds=int(float(r["beds"])),
                    baths=float(r["baths"]),
                    year_built=int(r["year_built"]),
                    property_type=r["property_type"].strip(),
                    lat=float(r["lat"]),
                    lon=float(r["lon"]),
                    pool=r["pool"].strip().lower() in {"true", "yes", "1", "y"},
                    garage=int(float(r["garage_spaces"] or 0)),
                )
                out.append(Sale(home, float(r["price"]), date.fromisoformat(r["close_date"]), id=r["id"]))
            except (ValueError, KeyError) as e:
                print(f"line {i}: skipped ({e})", file=sys.stderr)
        return sorted(out, key=lambda s: s.closed)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("csv", type=Path)
    parser.add_argument("--json", type=Path, help="also write the table as JSON")
    args = parser.parse_args(argv)
    sales = read_sales(args.csv)
    bands = backtest(sales)
    print(f"{len(sales)} closed sales")
    print(f"{'band':<16}{'n':>6}{'coverage':>10}{'median error':>14}")
    for b in bands:
        print(f"{b.band:<16}{b.n:>6}{b.coverage:>10.1%}{b.median_abs_error:>14.1%}")
    if args.json:
        args.json.write_text(json.dumps({"sales": len(sales), "bands": [asdict(b) for b in bands]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
