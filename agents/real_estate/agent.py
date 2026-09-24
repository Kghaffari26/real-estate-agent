"""Orchestrates the real estate agent's pipeline (SPEC_REAL_ESTATE.md §4):

    fetch (conditional) -> filter/normalize -> compute -> flags + temperature
        -> movers -> briefs (template, for now) -> validate -> publish

Called by `core.runner`. No LLM calls are made anywhere in this build —
`agents/real_estate/analyze.py` is the seam where SPEC §7's Batch API path
plugs in later; every brief's `narrative_source` is `"template"` until then.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import polars as pl

from agents.real_estate import (
    analyze,
    compute,
    fetch_fred,
    fetch_income,
    fetch_redfin,
    fetch_zillow,
    templates,
    transform,
)
from agents.real_estate import metrics as metric_registry
from agents.real_estate import movers as movers_mod
from agents.real_estate import state as state_mod
from agents.real_estate import temperature as temperature_mod
from agents.real_estate.config import Metro, load_metros, load_settings
from agents.real_estate.flags import evaluate_flags
from agents.real_estate.schema import (
    AffordabilityOut,
    AlertOut,
    CaseShiller,
    Citation,
    ConstructionSeriesValue,
    FlagOut,
    IndexOutput,
    KeyStat,
    MetricRegistryEntry,
    MetricValue,
    MetroDetailOutput,
    MetroSummary,
    MoverEntry,
    Movers,
    NationalBlock,
    NationalConstruction,
    NationalRates,
    PermitsValue,
    RatesLatest,
    TemperatureDetail,
    TemperatureSummary,
)
from core.http import HTTPClient
from core.publish import DEFAULT_SITE_DATA_DIR, PublishSizeError, publish_index, publish_item
from core.schema import RunMeta

AGENT_NAME = "real_estate"
HISTORY_MONTHS = 36
PERMIT_KEYS = ("permits_total", "permits_1unit", "permits_5plus")
STANDARD_METRO_KEYS = tuple(k for k in metric_registry.METRO_METRIC_KEYS if k not in PERMIT_KEYS)
NATIONAL_REDFIN_KEYS = STANDARD_METRO_KEYS  # the nation tracks the same core Redfin metrics
TEMPERATURE_COMPONENT_KEYS = tuple(temperature_mod.COMPONENTS)


def _series(df_rows: list[dict[str, Any]], key: str) -> list[tuple[date, float | None]]:
    return [(row["period_end"], row.get(key)) for row in df_rows]


def _load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def _summary_metric(change: compute.MetricChange) -> MetricValue:
    return MetricValue(value=change.value, yoy=change.yoy)


def _detail_metric(change: compute.MetricChange, delta_format: str) -> MetricValue:
    d = change.to_dict()
    d["delta_format"] = delta_format
    return MetricValue(**d)


def _compute_metro_metrics(
    rows: list[dict[str, Any]],
) -> tuple[dict[str, compute.MetricChange], dict[str, dict[str, float | None]]]:
    """Returns `(changes_by_key, permits_by_key)` for one metro's rows."""
    changes: dict[str, compute.MetricChange] = {}
    for key in STANDARD_METRO_KEYS:
        metric = metric_registry.get(key)
        changes[key] = compute.compute_metric_series(_series(rows, key), metric.change_kind, history_months=HISTORY_MONTHS)
    permits = {key: compute.compute_permits(_series(rows, key)) for key in PERMIT_KEYS}
    return changes, permits


def run(dry_run: bool = False, force_briefs: bool = False) -> RunMeta:
    started_at = datetime.now(UTC)
    warnings_list: list[str] = []

    metros = load_metros()
    settings = load_settings()
    state = state_mod.State.load()

    with HTTPClient() as client:
        metro_fetch = fetch_redfin.fetch_metro(
            client, tracked_regions={m.redfin_region for m in metros}, history_months=HISTORY_MONTHS
        )
        national_fetch = fetch_redfin.fetch_national(client, history_months=HISTORY_MONTHS)
        any_source_changed = metro_fetch.modified or national_fetch.modified

        zhvi_long = zori_long = None
        region_ids = {m.zillow_region_id for m in metros if m.zillow_region_id is not None}
        if region_ids:
            try:
                zhvi_dl = fetch_zillow.download_zhvi(client)
                zhvi_long = fetch_zillow.load_long(fetch_zillow.ZHVI_CSV_PATH, "zhvi", region_ids, HISTORY_MONTHS + 4)
                any_source_changed = any_source_changed or zhvi_dl.modified
            except Exception as exc:  # noqa: BLE001 - optional source, degrade per SPEC §10
                warnings_list.append(f"zhvi fetch/parse failed: {exc}")
            try:
                zori_dl = fetch_zillow.download_zori(client)
                zori_long = fetch_zillow.load_long(fetch_zillow.ZORI_CSV_PATH, "zori", region_ids, HISTORY_MONTHS + 4)
                any_source_changed = any_source_changed or zori_dl.modified
            except Exception as exc:  # noqa: BLE001
                warnings_list.append(f"zori fetch/parse failed: {exc}")

        permits_long = None
        if settings.use_permits:
            # fetch_permits.py's parser is ready, but the exact monthly Census
            # BPS URL is unverified from this environment (see its docstring);
            # degrade to null permits per SPEC §10 rather than guess a URL.
            warnings_list.append(
                "permits fetch skipped: exact Census BPS monthly URL is unverified in this environment"
            )

        income_by_cbsa: dict[str, int] = {}
        income_year: int | None = None
        if settings.use_acs_income:
            income_by_cbsa, income_year = fetch_income.load_cached()
            try:
                current_year = date.today().year - 1
                fresh = fetch_income.fetch_income_by_cbsa(client, current_year)
                income_by_cbsa, income_year = fresh, current_year
                fetch_income.save_cache(fresh, current_year)
            except Exception as exc:  # noqa: BLE001
                if not income_by_cbsa:
                    warnings_list.append(f"ACS income unavailable: {exc}")

        fred_series: dict[str, list[dict[str, str]]] = {}
        try:
            fred_series = fetch_fred.fetch_all_national(client)
            prior_m30 = state.sources.get("fred", {}).get("MORTGAGE30US")
            latest_m30 = fetch_fred.latest_value(fred_series.get("mortgage30", []))
            if latest_m30 and f"{latest_m30[0]}:{latest_m30[1]}" != prior_m30:
                any_source_changed = True
        except Exception as exc:  # noqa: BLE001 - degrade gracefully rather than fail the whole run
            warnings_list.append(f"FRED fetch failed: {exc}")

    metro_df = transform.build_metro_frame(
        pl.scan_parquet(metro_fetch.parquet_path).collect(),
        metros,
        zhvi_long,
        zori_long,
        permits_long,
    )
    national_rows = pl.scan_parquet(national_fetch.parquet_path).sort("period_end").collect().to_dicts()

    metro_data_dir = Path(DEFAULT_SITE_DATA_DIR) / AGENT_NAME / "metros"

    # -- per-metro computation ------------------------------------------
    per_metro_rows: dict[str, list[dict[str, Any]]] = {}
    per_metro_changes: dict[str, dict[str, compute.MetricChange]] = {}
    per_metro_permits: dict[str, dict[str, dict[str, float | None]]] = {}
    per_metro_data_through: dict[str, date | None] = {}
    global_data_through = national_rows[-1]["period_end"] if national_rows else None

    for m in metros:
        rows = metro_df.filter(pl.col("slug") == m.slug).sort("period_end").to_dicts()
        per_metro_rows[m.slug] = rows
        changes, permits = _compute_metro_metrics(rows)
        per_metro_changes[m.slug] = changes
        per_metro_permits[m.slug] = permits
        per_metro_data_through[m.slug] = rows[-1]["period_end"] if rows else None
        if not rows:
            warnings_list.append(f"{m.slug}: missing from the latest Redfin data; publishing stale")

    for key in STANDARD_METRO_KEYS:
        compute.add_percentile_ranks({slug: per_metro_changes[slug][key] for slug in per_metro_changes})

    temperature_inputs = {
        slug: {
            comp: per_metro_changes[slug][comp].value if comp in per_metro_changes[slug] else None
            for comp in TEMPERATURE_COMPONENT_KEYS
        }
        for slug in per_metro_changes
    }
    temperatures = temperature_mod.compute_temperatures(
        temperature_inputs, settings.temperature_min_components, settings.temperature_bands
    )

    # -- FRED-derived national figures -----------------------------------
    def _fred_obs(key: str) -> list[dict[str, str]]:
        return fred_series.get(key, [])

    def _fred_series_pairs(key: str) -> list[tuple[date, float]]:
        return [(date.fromisoformat(o["date"]), float(o["value"])) for o in _fred_obs(key)]

    m30_obs = _fred_obs("mortgage30")
    m30_latest = fetch_fred.latest_value(m30_obs)
    m30_prev = float(m30_obs[-2]["value"]) if len(m30_obs) >= 2 else None
    m30_change_1w = (m30_latest[1] - m30_prev) if (m30_latest and m30_prev is not None) else None
    m30_year_ago = fetch_fred.value_n_days_before(m30_obs, 364) if m30_obs else None
    rates_as_of = date.fromisoformat(m30_latest[0]) if m30_latest else global_data_through

    m15_pairs = _fred_series_pairs("mortgage15")
    m30_pairs = _fred_series_pairs("mortgage30")
    rate_dates = sorted({d for d, _ in m30_pairs} | {d for d, _ in m15_pairs})[-156:]  # ~3 years weekly

    housing_starts_change = compute.compute_metric_series(_fred_series_pairs("housing_starts"), "ratio")
    permits_national_change = compute.compute_metric_series(_fred_series_pairs("permits_national"), "ratio")
    case_shiller_change = compute.compute_metric_series(_fred_series_pairs("case_shiller"), "ratio")

    # -- national Redfin-derived metrics ----------------------------------
    national_changes = {
        key: compute.compute_metric_series(_series(national_rows, key), metric_registry.get(key).change_kind, history_months=HISTORY_MONTHS)
        for key in NATIONAL_REDFIN_KEYS
    }
    national_history = {
        comp: [v for _d, v in _series(national_rows, comp) if v is not None][-HISTORY_MONTHS:]
        for comp in TEMPERATURE_COMPONENT_KEYS
    }
    national_latest_components = {comp: national_changes[comp].value for comp in TEMPERATURE_COMPONENT_KEYS}
    national_temperature = temperature_mod.compute_temperature_own_history(
        national_latest_components, national_history, settings.temperature_min_components, settings.temperature_bands
    )

    national_dates = compute.month_end_dates(global_data_through, HISTORY_MONTHS) if global_data_through else []
    national_series_keys = (
        "median_sale_price",
        "inventory",
        "median_dom",
        "price_drops",
        "avg_sale_to_list",
        "months_of_supply",
        "homes_sold",
        "new_listings",
    )
    national_series: dict[str, list[Any]] = {"dates": [d.isoformat() for d in national_dates]}
    for key in national_series_keys:
        national_series[key] = compute.series_for_dates(_series(national_rows, key), national_dates)

    # -- flags, alerts, movers --------------------------------------------
    flags_by_slug: dict[str, list[Any]] = {}
    metro_facts_by_slug: dict[str, dict[str, Any]] = {}
    per_metro_affordability: dict[str, compute.Affordability | None] = {}
    for m in metros:
        c = per_metro_changes[m.slug]
        p = per_metro_permits[m.slug]
        rows = per_metro_rows[m.slug]
        mos_prior = compute.value_at_offset(_series(rows, "months_of_supply"), 1)

        income = income_by_cbsa.get(m.cbsa) if m.cbsa else None
        affordability: compute.Affordability | None = None
        if m30_latest and c["median_sale_price"].value is not None:
            price_year_ago = compute.value_at_offset(_series(rows, "median_sale_price"), 12)
            affordability = compute.compute_affordability(
                price_now=c["median_sale_price"].value,
                price_year_ago=price_year_ago,
                rate_now=m30_latest[1],
                rate_year_ago=m30_year_ago,
                median_household_income=income,
                income_year=income_year,
            )
        per_metro_affordability[m.slug] = affordability

        flag_list = evaluate_flags(
            inventory_yoy=c["inventory"].yoy,
            median_sale_price_yoy=c["median_sale_price"].yoy,
            median_sale_price_high_36m=c["median_sale_price"].high_36m,
            median_sale_price_low_36m=c["median_sale_price"].low_36m,
            price_drops_yoy=c["price_drops"].yoy,
            price_drops_high_36m=c["price_drops"].high_36m,
            median_dom_yoy=c["median_dom"].yoy,
            months_of_supply_value=c["months_of_supply"].value,
            months_of_supply_prior=mos_prior,
            zori_yoy=c["zori"].yoy,
            zhvi_yoy=c["zhvi"].yoy,
            permits_yoy_12m=p["permits_total"]["yoy_12m"],
            payment_change_pct=affordability.payment_change_pct if affordability else None,
            thresholds=settings.flags,
        )
        flags_by_slug[m.slug] = flag_list

        data_through_str = per_metro_data_through[m.slug] or global_data_through
        facts = analyze.build_metro_facts(
            metro_name=m.name,
            data_through=data_through_str.strftime("%B %Y") if data_through_str else "",
            median_sale_price=c["median_sale_price"].to_dict(),
            inventory=c["inventory"].to_dict(),
            median_dom=c["median_dom"].to_dict(),
            price_drops=c["price_drops"].to_dict(),
            sale_to_list=c["avg_sale_to_list"].to_dict(),
            months_of_supply_value=c["months_of_supply"].value,
            months_of_supply_yoy=c["months_of_supply"].yoy,
            zori=c["zori"].to_dict(),
            temperature_label=temperatures[m.slug].label,
            temperature_score=temperatures[m.slug].score,
            market_type=temperature_mod.market_type(c["months_of_supply"].value),
            flag_labels=[f.label for f in flag_list],
            mortgage30_pct=m30_latest[1] if m30_latest else None,
            mortgage30_year_ago_pct=m30_year_ago,
            payment_now=affordability.payment_now if affordability else None,
            payment_change_pct=affordability.payment_change_pct if affordability else None,
        )
        metro_facts_by_slug[m.slug] = facts

    alert_groups: dict[str, list[str]] = defaultdict(list)
    alert_meta: dict[str, tuple[str, str]] = {}
    for slug, flag_list in flags_by_slug.items():
        for f in flag_list:
            if f.severity in ("notable", "major"):
                alert_groups[f.id].append(slug)
                alert_meta.setdefault(f.id, (f.label, f.severity))
    alerts = [
        AlertOut(flag=fid, label=alert_meta[fid][0], severity=alert_meta[fid][1], slugs=slugs)
        for fid, slugs in sorted(alert_groups.items(), key=lambda kv: -len(kv[1]))
    ]

    mover_entries = [
        {
            "slug": m.slug,
            "name": m.name,
            "homes_sold_12m": compute.trailing_sum(_series(per_metro_rows[m.slug], "homes_sold")),
            "median_sale_price_yoy": per_metro_changes[m.slug]["median_sale_price"].yoy,
            "inventory_yoy": per_metro_changes[m.slug]["inventory"].yoy,
            "temperature_score": temperatures[m.slug].score,
        }
        for m in metros
    ]

    def _to_mover_list(key: str, entries: list[dict[str, Any]]) -> list[MoverEntry]:
        return [MoverEntry(slug=e["slug"], name=e["name"], value=e[key]) for e in entries]

    raw_movers = movers_mod.compute_movers(mover_entries)
    movers = Movers(
        price_gains=_to_mover_list("median_sale_price_yoy", raw_movers["price_gains"]),
        price_declines=_to_mover_list("median_sale_price_yoy", raw_movers["price_declines"]),
        inventory_growth=_to_mover_list("inventory_yoy", raw_movers["inventory_growth"]),
        temperature_top=_to_mover_list("temperature_score", raw_movers["temperature_top"]),
        temperature_bottom=_to_mover_list("temperature_score", raw_movers["temperature_bottom"]),
    )

    price_drops_count = sum(1 for c in per_metro_changes.values() if (c["price_drops"].yoy or 0) > 0)
    headline = templates.headline(
        inventory_national_yoy=national_changes["inventory"].yoy,
        price_national_yoy=national_changes["median_sale_price"].yoy,
        price_drops_count=price_drops_count,
        total_metros=len(metros),
    )
    key_stats = [
        KeyStat(
            label="US median sale price",
            value=national_changes["median_sale_price"].value or 0,
            format="currency_compact",
            delta=national_changes["median_sale_price"].yoy,
            delta_format="percent_signed",
        ),
        KeyStat(
            label="30-yr mortgage",
            value=m30_latest[1] if m30_latest else 0,
            format="percent",
            delta=m30_change_1w,
            delta_format="pp_signed",
        ),
    ]

    # -- national brief -----------------------------------------------
    national_facts = {
        "metro": "the United States",
        "data_through": global_data_through.strftime("%B %Y") if global_data_through else "",
        "metrics": {
            "median_sale_price": {
                "value": national_changes["median_sale_price"].value,
                "yoy_pct": analyze.to_pct(national_changes["median_sale_price"].yoy),
            },
            "inventory": {
                "value": national_changes["inventory"].value,
                "yoy_pct": analyze.to_pct(national_changes["inventory"].yoy),
            },
        },
        "rates": {"mortgage30_pct": m30_latest[1] if m30_latest else None},
    }
    national_changed, national_new_hash = state_mod.facts_changed(state, "national", national_facts)
    if national_changed or force_briefs:
        national_brief = analyze.generate_national_brief(
            national_facts,
            [a.model_dump() for a in alerts[:5]],
            {"have more price cuts than a year ago": price_drops_count},
        )
        any_source_changed = True
    else:
        prior_index = _load_json(Path(DEFAULT_SITE_DATA_DIR) / AGENT_NAME / "latest.json")
        prior_brief = (prior_index or {}).get("national", {}).get("brief")
        national_brief = analyze.reuse_brief(prior_brief) if prior_brief else analyze.generate_national_brief(
            national_facts, [a.model_dump() for a in alerts[:5]], {"have more price cuts than a year ago": price_drops_count}
        )
    state.brief_hashes["national"] = national_new_hash

    # -- assemble metro summaries + detail files --------------------------
    metro_summaries: list[MetroSummary] = []
    for m in metros:
        c = per_metro_changes[m.slug]
        p = per_metro_permits[m.slug]
        rows = per_metro_rows[m.slug]
        flag_list = flags_by_slug[m.slug]
        facts = metro_facts_by_slug[m.slug]
        cache_facts = {k: v for k, v in facts.items() if k not in ("rates", "affordability")}
        changed, new_hash = state_mod.facts_changed(state, m.slug, cache_facts)
        any_source_changed = any_source_changed or changed

        prior_metro = _load_json(metro_data_dir / f"{m.slug}.json")
        if changed or force_briefs or not prior_metro:
            brief = analyze.generate_metro_brief(facts, reused=False)
        else:
            brief = analyze.reuse_brief(prior_metro["brief"])
        state.brief_hashes[m.slug] = new_hash

        summary_latest: dict[str, MetricValue | PermitsValue] = {
            key: _summary_metric(c[key]) for key in STANDARD_METRO_KEYS
        }
        for key in PERMIT_KEYS:
            summary_latest[key] = PermitsValue(**p[key])

        detail_latest: dict[str, MetricValue | PermitsValue] = {
            key: _detail_metric(c[key], metric_registry.get(key).delta_format) for key in STANDARD_METRO_KEYS
        }
        for key in PERMIT_KEYS:
            detail_latest[key] = PermitsValue(**p[key])

        aff = per_metro_affordability[m.slug]
        affordability_out: AffordabilityOut | None = None
        if aff is not None:
            affordability_out = AffordabilityOut(
                payment_now=aff.payment_now,
                payment_year_ago=aff.payment_year_ago,
                payment_change_pct=aff.payment_change_pct,
                payment_to_income=aff.payment_to_income,
                median_household_income=aff.median_household_income,
                income_year=aff.income_year,
                assumptions=aff.assumptions,
            )

        stale = not rows or (global_data_through is not None and per_metro_data_through[m.slug] != global_data_through)
        metro_data_through = per_metro_data_through[m.slug] or global_data_through
        metro_dates = compute.month_end_dates(metro_data_through, HISTORY_MONTHS) if metro_data_through else []
        detail_series: dict[str, list[Any]] = {"dates": [d.isoformat() for d in metro_dates]}
        for key in metric_registry.METRO_METRIC_KEYS:
            detail_series[key] = compute.series_for_dates(_series(rows, key), metro_dates)

        temp = temperatures[m.slug]
        summary = MetroSummary(
            slug=m.slug,
            name=m.name,
            cbsa=m.cbsa,
            lat=m.lat,
            lon=m.lon,
            homes_sold_12m=compute.trailing_sum(_series(rows, "homes_sold")),
            latest=summary_latest,
            temperature=TemperatureSummary(score=temp.score, label=temp.label),
            market_type=temperature_mod.market_type(c["months_of_supply"].value),
            flags=[f.id for f in flag_list],
            brief_excerpt=brief.text.split(". ")[0][:160] if brief.text else "",
            stale=stale,
        )
        metro_summaries.append(summary)

        detail = MetroDetailOutput(
            slug=m.slug,
            name=m.name,
            cbsa=m.cbsa,
            lat=m.lat,
            lon=m.lon,
            data_through=metro_data_through or date.today(),
            latest=detail_latest,
            temperature=TemperatureDetail(score=temp.score, label=temp.label, components=temp.components),
            market_type=temperature_mod.market_type(c["months_of_supply"].value),
            flags=[FlagOut(id=f.id, label=f.label, severity=f.severity, facts=f.facts) for f in flag_list],
            affordability=affordability_out,
            series=detail_series,
            brief=brief,
            stale=stale,
        )

        if not dry_run:
            try:
                publish_item(AGENT_NAME, m.slug, detail, subdir="metros", max_kb=settings.max_metro_kb)
            except PublishSizeError:
                warnings_list.append(f"{m.slug}: metro file too large, trimming to 24 months")
                trimmed_dates = metro_dates[-24:]
                detail.series = {"dates": [d.isoformat() for d in trimmed_dates]} | {
                    key: compute.series_for_dates(_series(rows, key), trimmed_dates)
                    for key in metric_registry.METRO_METRIC_KEYS
                }
                publish_item(AGENT_NAME, m.slug, detail, subdir="metros")

    index = IndexOutput(
        meta=RunMeta(
            agent=AGENT_NAME,
            started_at=started_at,
            finished_at=datetime.now(UTC),
            cost_usd=0.0,
            status="ok",
            data_changed=any_source_changed,
            warnings=warnings_list,
        ),
        headline=headline,
        key_stats=key_stats,
        data_through=global_data_through or date.today(),
        rates_as_of=rates_as_of or (global_data_through or date.today()),
        metric_registry=[MetricRegistryEntry(**d) for d in metric_registry.registry_for_site()],
        national=NationalBlock(
            latest={key: _detail_metric(national_changes[key], metric_registry.get(key).delta_format) for key in NATIONAL_REDFIN_KEYS},
            temperature=TemperatureSummary(
                score=national_temperature.score, label=national_temperature.label, basis="vs its own 3-year history"
            ),
            series=national_series,
            rates=NationalRates(
                dates=[d.isoformat() for d in rate_dates],
                mortgage30=[dict(m30_pairs).get(d) for d in rate_dates],
                mortgage15=[dict(m15_pairs).get(d) for d in rate_dates],
                latest=RatesLatest(
                    mortgage30=m30_latest[1] if m30_latest else None,
                    mortgage30_change_1w_pp=m30_change_1w,
                    mortgage30_year_ago=m30_year_ago,
                ),
            ),
            construction=NationalConstruction(
                housing_starts=ConstructionSeriesValue(
                    value=housing_starts_change.value,
                    mom=housing_starts_change.mom,
                    units="thousands, SAAR",
                    period=_fred_obs("housing_starts")[-1]["date"] if _fred_obs("housing_starts") else None,
                ),
                permits=ConstructionSeriesValue(
                    value=permits_national_change.value,
                    mom=permits_national_change.mom,
                    units="thousands, SAAR",
                    period=_fred_obs("permits_national")[-1]["date"] if _fred_obs("permits_national") else None,
                ),
                series={
                    "dates": [o["date"] for o in _fred_obs("housing_starts")],
                    "housing_starts": [float(o["value"]) for o in _fred_obs("housing_starts")],
                    "permits": [float(o["value"]) for o in _fred_obs("permits_national")],
                },
            ),
            case_shiller=CaseShiller(
                value=case_shiller_change.value,
                yoy=case_shiller_change.yoy,
                period=_fred_obs("case_shiller")[-1]["date"] if _fred_obs("case_shiller") else None,
            ),
            brief=national_brief,
        ),
        metros=metro_summaries,
        movers=movers,
        alerts=alerts,
        sources=[
            Citation(
                name="Redfin Data Center",
                url="https://www.redfin.com/news/data-center/",
                attribution="Data: Redfin, a national real estate brokerage.",
            ),
            Citation(
                name="Zillow Research",
                url="https://www.zillow.com/research/data/",
                attribution="Zillow Home Value Index (ZHVI) and Zillow Observed Rent Index (ZORI)",
            ),
            Citation(name="FRED, Federal Reserve Bank of St. Louis", url="https://fred.stlouisfed.org/"),
            Citation(
                name="U.S. Census Bureau, Building Permits Survey",
                url="https://www.census.gov/construction/bps/",
            ),
        ],
    )

    if dry_run:
        _print_dry_run_table(metros, per_metro_changes, temperatures, flags_by_slug)
        return index.meta

    try:
        publish_index(AGENT_NAME, index, max_kb=settings.max_index_kb)
    except PublishSizeError:
        warnings_list.append("index too large; dropping non-core national series")
        index.national.series = {k: v for k, v in index.national.series.items() if k in ("dates", "median_sale_price", "inventory")}
        index.meta.warnings = warnings_list
        publish_index(AGENT_NAME, index)

    state.sources["redfin_metro"] = {
        "data_through": metro_fetch.data_through,
    }
    state.sources["redfin_national"] = {"data_through": national_fetch.data_through}
    if m30_latest:
        state.sources.setdefault("fred", {})["MORTGAGE30US"] = f"{m30_latest[0]}:{m30_latest[1]}"
    state.save()

    return index.meta


def _print_dry_run_table(
    metros: list[Metro],
    changes: dict[str, dict[str, compute.MetricChange]],
    temperatures: dict[str, temperature_mod.Temperature],
    flags_by_slug: dict[str, list[Any]],
) -> None:
    header = f"{'slug':<20}{'price':>12}{'yoy':>8}{'inv_yoy':>10}{'temp':>8}{'flags'}"
    print(header)
    print("-" * len(header))
    for m in metros:
        c = changes.get(m.slug, {})
        price = c.get("median_sale_price")
        inv = c.get("inventory")
        temp = temperatures.get(m.slug)
        flag_ids = ",".join(f.id for f in flags_by_slug.get(m.slug, []))
        price_val = f"{price.value:,.0f}" if price and price.value is not None else "-"
        price_yoy = f"{price.yoy:+.1%}" if price and price.yoy is not None else "-"
        inv_yoy = f"{inv.yoy:+.1%}" if inv and inv.yoy is not None else "-"
        temp_str = f"{temp.score}" if temp and temp.score is not None else "-"
        print(f"{m.slug:<20}{price_val:>12}{price_yoy:>8}{inv_yoy:>10}{temp_str:>8}  {flag_ids}")
