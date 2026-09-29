"""Add §6.4 timelines to the dashboard's committed sample snapshot, using the agent's
own code on the real Redfin Data Center files.

Why a script and not a full re-run: a faithful re-run needs FRED and Anthropic keys
(rates and narratives). This keeps the snapshot's run as it was and adds only
what schema 1.3.0 added: `timeline/<metric>.json` (built by `timeline.build_timelines`
from the same `all_metros.csv` the snapshot's run read, capped at the snapshot's
`data_through`) and the index's `timelines` refs.

Before writing anything it checks every metro's last 36 months against the
snapshot's `metros/<slug>.json` series (rounded the same way) and stops on any
mismatch, so the timelines provably continue the snapshot's own numbers.

    uv run python scripts/build_sample_timelines.py [--sample dashboard/sample-data]
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from agents_core.http import Http

from agents.real_estate import fetch_redfin
from agents.real_estate import timeline as tl
from agents.real_estate.agent import _first_month, json_size
from agents.real_estate.config import load_metros, load_settings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--sample", default="dashboard/sample-data", type=Path)
    args = parser.parse_args()
    sample: Path = args.sample
    index = json.loads((sample / "latest.json").read_text(encoding="utf8"))
    through = date.fromisoformat(index["data_through"])
    metros = load_metros()
    settings = load_settings()
    since = _first_month(settings.timeline_since)

    with Http(cache_dir=Path("data/cache/http")) as http:
        http.download(fetch_redfin.METRO_URL, fetch_redfin.DC_METRO_CSV_PATH)
        http.download(fetch_redfin.PRICE_DROPS_METRO_URL, fetch_redfin.DC_PRICE_DROPS_METRO_CSV_PATH)
    frame = fetch_redfin.dc_frame(
        fetch_redfin.DC_METRO_CSV_PATH,
        fetch_redfin.DC_PRICE_DROPS_METRO_CSV_PATH,
        region_type="metro",
        history_months=0,
        tracked_regions={m.redfin_region for m in metros},
        since=since,
    )
    rows = [r for r in frame.to_dicts() if r["period_end"] <= through]
    built = tl.build_timelines(rows, metros, since, through)
    kept, warnings = tl.fit(built, json_size, int(settings.max_timeline_kb * 1024))
    for w in warnings:
        print("warning:", w)

    # The timelines must continue the snapshot's own numbers exactly.
    mismatches = []
    for m in metros:
        detail = json.loads((sample / "metros" / f"{m.slug}.json").read_text(encoding="utf8"))
        dates = [date.fromisoformat(d) for d in detail["series"]["dates"]]
        for key, decimals in tl.TIMELINE_METRICS.items():
            if key not in kept:
                continue
            series = kept[key]
            pos = {d: i for i, d in enumerate(series.dates)}
            for d, v in zip(dates, detail["series"][key], strict=True):
                expected = tl._round(v, decimals)
                got = series.metros[m.slug][pos[d]] if d in pos else "missing"
                if expected != got:
                    mismatches.append(f"{m.slug} {key} {d}: snapshot {expected} vs timeline {got}")
    if mismatches:
        print(f"{len(mismatches)} mismatches with the snapshot; nothing written. First ones:")
        print("\n".join(mismatches[:15]))
        return 1

    out_dir = sample / "timeline"
    out_dir.mkdir(exist_ok=True)
    for key, t in kept.items():
        (out_dir / f"{key}.json").write_text(t.model_dump_json(), encoding="utf8")
        nonnull = sum(v is not None for s in t.metros.values() for v in s)
        print(f"timeline/{key}.json  {json_size(t) / 1024:.1f} KB  {len(t.dates)} months  {nonnull} values")
    index["timelines"] = [r.model_dump(mode="json") for r in tl.refs(kept)]
    (sample / "latest.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    print(f"latest.json: timelines = {[r['metric'] for r in index['timelines']]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
