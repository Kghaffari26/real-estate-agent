"""Add the §6.5-6.7 files (events.json, pulse.json, areas/<slug>.json) to the
dashboard's committed sample snapshot, using the agent's own code on the real files.

Like `build_sample_timelines.py`, this keeps the snapshot's run as it was and adds
only what schema 1.4.0 added, capped at the snapshot's own dates (Redfin through its
`data_through`, rates through its `rates_as_of`, weekly windows through its run date).
Rates come from FRED's public CSV of the same series (MORTGAGE30US) because a
faithful API fetch needs a key.

Before writing anything it checks that the inputs continue the snapshot's own numbers
(the rates' last 3 years and the national median price's last 36 months) and stops on
any mismatch.

    uv run python scripts/build_sample_extensions.py [--sample dashboard/sample-data]
"""

from __future__ import annotations

import argparse
import csv
import io
import json
from datetime import date, datetime
from pathlib import Path

import polars as pl
from agents_core.http import Http

from agents.real_estate import areas as areas_mod
from agents.real_estate import events as events_mod
from agents.real_estate import fetch_redfin
from agents.real_estate import pulse as pulse_mod
from agents.real_estate.agent import _first_month, json_size
from agents.real_estate.config import load_metros, load_settings

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--sample", default="dashboard/sample-data", type=Path)
    args = parser.parse_args()
    sample: Path = args.sample
    index = json.loads((sample / "latest.json").read_text(encoding="utf8"))
    through = date.fromisoformat(index["data_through"])
    rates_as_of = date.fromisoformat(index["rates_as_of"])
    run_day = datetime.fromisoformat(index["meta"]["finished_at"].replace("Z", "+00:00")).date()
    metros = load_metros()
    settings = load_settings()
    since = _first_month(settings.timeline_since)
    tracked = {m.redfin_region for m in metros}

    with Http(cache_dir=Path("data/cache/http")) as http:
        http.download(fetch_redfin.NATIONAL_URL, fetch_redfin.DC_NATIONAL_CSV_PATH)
        fred_text = http.get(FRED_CSV).text
        weekly = fetch_redfin.fetch_weekly(http, tracked_regions=tracked, columns=pulse_mod.PULSE_COLUMNS)
        counties = fetch_redfin.fetch_counties(http, tracked_regions=tracked, columns=areas_mod.AREA_COLUMNS)

    rates = [
        (date.fromisoformat(r["observation_date"]), float(r["MORTGAGE30US"]))
        for r in csv.DictReader(io.StringIO(fred_text))
        if r["MORTGAGE30US"] not in ("", ".")
    ]
    rates = [(d, v) for d, v in rates if d <= rates_as_of]
    national = fetch_redfin.dc_frame(
        fetch_redfin.DC_NATIONAL_CSV_PATH,
        None,
        region_type="country",
        history_months=0,
        tracked_regions=None,
        since=date(since.year - 1, since.month, 1),
    ).to_dicts()
    national = [r for r in national if r["period_end"] <= through]

    # The inputs must continue the snapshot's own numbers.
    mismatches = []
    snap_rates = dict(zip(index["national"]["rates"]["dates"], index["national"]["rates"]["mortgage30"], strict=True))
    fred = {d.isoformat(): v for d, v in rates}
    mismatches += [f"rate {d}: snapshot {v} vs FRED {fred.get(d)}" for d, v in snap_rates.items() if v is not None and fred.get(d) != v]
    nat = {r["period_end"].isoformat(): r["median_sale_price"] for r in national}
    series = index["national"]["series"]
    mismatches += [
        f"national price {d}: snapshot {v} vs file {nat.get(d)}"
        for d, v in zip(series["dates"], series["median_sale_price"], strict=True)
        if v is not None and (nat.get(d) is None or abs(nat[d] - v) > 0.5)
    ]
    if mismatches:
        print(f"{len(mismatches)} mismatches with the snapshot; nothing written. First ones:")
        print("\n".join(mismatches[:15]))
        return 1

    built_events = events_mod.build_events(rates, national, since, max(through, rates_as_of))
    ev, warnings = events_mod.fit(built_events, json_size, int(settings.max_events_kb * 1024))
    weekly_rows = [r for r in pl.read_parquet(weekly.parquet_path).to_dicts() if r["period_end"] <= run_day]
    built_pulse = pulse_mod.build_pulse(weekly_rows, metros, settings.pulse_weeks)
    pl_out, w2 = pulse_mod.fit(built_pulse, json_size, int(settings.max_pulse_kb * 1024)) if built_pulse else (None, [])
    county_rows = [r for r in pl.read_parquet(counties.parquet_path).to_dicts() if r["period_end"] <= through]
    built_areas = areas_mod.build_areas(county_rows, metros, areas_mod.load_centroids(), through)
    ar, w3 = areas_mod.fit(built_areas, json_size, int(settings.max_area_kb * 1024))
    for w in (*warnings, *w2, *w3):
        print("warning:", w)

    if ev:
        (sample / "events.json").write_text(ev.model_dump_json(), encoding="utf8")
        print(f"events.json  {json_size(ev) / 1024:.1f} KB  {len(ev.events)} events")
        for e in ev.events:
            print(f"  {e.date} {e.kind:22} {e.value}")
    if pl_out:
        (sample / "pulse.json").write_text(pl_out.model_dump_json(), encoding="utf8")
        print(f"pulse.json  {json_size(pl_out) / 1024:.1f} KB  {len(pl_out.metros)} metros, weeks {pl_out.weeks[0]}..{pl_out.weeks[-1]}")
    (sample / "areas").mkdir(exist_ok=True)
    for slug, a in ar.items():
        (sample / "areas" / f"{slug}.json").write_text(a.model_dump_json(), encoding="utf8")
    sizes = [json_size(a) for a in ar.values()]
    print(f"areas/  {len(ar)} metros, {sum(len(a.areas) for a in ar.values())} counties, largest {max(sizes) / 1024:.1f} KB")

    index["events"] = events_mod.ref(ev).model_dump(mode="json") if ev else None
    index["pulse"] = pulse_mod.ref(pl_out).model_dump(mode="json") if pl_out else None
    index["areas"] = [r.model_dump(mode="json") for r in areas_mod.refs(ar)]
    (sample / "latest.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    print("latest.json: events, pulse, areas refs added")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
