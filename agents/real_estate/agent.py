"""The real estate agent (SPEC_REAL_ESTATE.md §4), as an `agents_core.agent.Agent`
registered under the `agents_core.agents` entry point (see `pyproject.toml`):

    fetch      conditional GETs (Redfin, Zillow), FRED, ACS income    -- no LLM
    transform  filter/normalize -> compute -> flags + temperature
               -> movers -> facts dicts -> investigator world/targets -- no LLM
    analyze    briefs (LLM for changed facts, previous output otherwise)
               -> metro investigations (agent loop, §6.3) -> assemble
               latest.json + metros/<slug>.json, enforce size limits

agents-core's runner validates the result against `IndexOutput`, adds `meta`
(including `meta.warnings`, from `ctx.warn`), and publishes `latest.json`,
`metros/`, `history/`, `manifest-entry.json`, `costs-summary.json`,
`schema.json`, `trace.json` and `trace.schema.json` to `public-data/`.
`--dry-run` stops after `transform`, so it makes zero LLM calls and publishes
nothing. Without an Anthropic API key the run still publishes (status ok):
every new narrative is the deterministic template, with a warning.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

import polars as pl
from agents_core import tracing
from agents_core.agent import Agent, AgentResult, RunContext
from agents_core.http import HostPolicy, Http
from agents_core.llm import LLM, LLMError
from agents_core.schema import RunMeta, Source
from pydantic import BaseModel, ValidationError

from agents.real_estate import (
    analyze,
    compute,
    fetch_fred,
    fetch_income,
    fetch_redfin,
    fetch_zillow,
    investigate,
    templates,
    transform,
)
from agents.real_estate import metrics as metric_registry
from agents.real_estate import movers as movers_mod
from agents.real_estate import state as state_mod
from agents.real_estate import temperature as temperature_mod
from agents.real_estate.config import Metro, Settings, load_metros, load_settings
from agents.real_estate.flags import Flag, build_alerts, evaluate_flags
from agents.real_estate.schema import (
    AffordabilityOut,
    AlertOut,
    Brief,
    CaseShiller,
    Citation,
    ConstructionSeriesValue,
    FlagOut,
    IndexOutput,
    Investigation,
    InvestigationSummary,
    KeyStat,
    MetricRegistryEntry,
    MetricSummaryValue,
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

AGENT_NAME = "real_estate"
HISTORY_MONTHS = 36
TRIMMED_HISTORY_MONTHS = 24
PERMIT_KEYS = ("permits_total", "permits_1unit", "permits_5plus")
STANDARD_METRO_KEYS = tuple(k for k in metric_registry.METRO_METRIC_KEYS if k not in PERMIT_KEYS)
NATIONAL_REDFIN_KEYS = STANDARD_METRO_KEYS  # the nation tracks the same core Redfin metrics
TEMPERATURE_COMPONENT_KEYS = tuple(temperature_mod.COMPONENTS)
NATIONAL_SERIES_KEYS = (
    "median_sale_price",
    "inventory",
    "median_dom",
    "price_drops",
    "avg_sale_to_list",
    "months_of_supply",
    "homes_sold",
    "new_listings",
)
# §10: an oversized index first drops national.series beyond the core 6.
CORE_NATIONAL_SERIES_KEYS = NATIONAL_SERIES_KEYS[:6]
FORCE_BRIEFS_FLAG = "--force-briefs"
NO_KEY_WARNING = (
    "No Anthropic API key (ANTHROPIC_API_KEY or AGENTS_ANTHROPIC_API_KEY): new briefs and"
    " investigations use deterministic templates"
)
# latest.json is measured with a representative meta block before the runner adds
# the real one (whose timestamps/cost digits can differ slightly): keep this margin.
INDEX_SIZE_MARGIN_BYTES = 512

INDEX_SOURCES = [
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
]


class PublishSizeError(RuntimeError):
    """A published file is still over its `config/real_estate.toml` size limit
    after the §10 trimming steps. Fails the run (the previous data stays)."""


def llm_available(llm: LLM) -> bool:
    """False when there's no Anthropic key (and no injected client, as in tests):
    the run then publishes templates instead of failing."""
    try:
        llm.client  # noqa: B018 - builds the SDK client; raises without a key
    except RuntimeError:
        return False
    return True


def fit_index(
    body: dict[str, Any], measure: Callable[[dict[str, Any]], int], limit_bytes: int
) -> tuple[dict[str, Any], list[str]]:
    """§10: an index over `max_index_kb` drops `national.series` metrics beyond the
    core 6, then fails with `PublishSizeError` if it's still too large. Returns the
    (possibly trimmed) body and the warnings to publish."""
    if measure(body) <= limit_bytes:
        return body, []
    national = body["national"]
    national.series = {k: v for k, v in national.series.items() if k == "dates" or k in CORE_NATIONAL_SERIES_KEYS}
    warnings = [f"latest.json over {limit_bytes} bytes: dropped national.series beyond the core 6 (§10)"]
    if measure(body) > limit_bytes:
        for metro in body["metros"]:
            metro.spark = []
        warnings.append(f"latest.json over {limit_bytes} bytes: dropped metros[].spark (§6.3)")
    size = measure(body)
    if size > limit_bytes:
        raise PublishSizeError(f"latest.json is {size} bytes after trimming (limit {limit_bytes})")
    return body, warnings


def _series(df_rows: list[dict[str, Any]], key: str) -> list[tuple[date, float | None]]:
    return [(row["period_end"], row.get(key)) for row in df_rows]


SPARK_MONTHS = 24


def spark_series(rows: list[dict[str, Any]], through: date | None, months: int = SPARK_MONTHS) -> list[int | None]:
    """§6.3 `metros[].spark`: the last `months` month-end median sale prices through
    `through`, rounded to whole dollars, oldest first (null where a month is missing)."""
    if through is None:
        return []
    dates = compute.month_end_dates(through, months)
    values = compute.series_for_dates(_series(rows, "median_sale_price"), dates)
    return [round(v) if v is not None else None for v in values]


def _summary_metric(change: compute.MetricChange) -> MetricSummaryValue:
    return MetricSummaryValue(value=change.value, yoy=change.yoy)


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
        changes[key] = compute.compute_metric_series(
            _series(rows, key), metric.change_kind, history_months=HISTORY_MONTHS
        )
    permits = {key: compute.compute_permits(_series(rows, key)) for key in PERMIT_KEYS}
    return changes, permits


def _prior_major_flag_ids(rows: list[dict[str, Any]], thresholds: dict[str, float]) -> set[str]:
    """Flag ids that were already `major` a month earlier (the data minus its latest
    month), so the investigator only picks up *new* major flags. Only the inventory
    surge and price decline flags can be major, so only those inputs are needed."""
    if len(rows) < 2:
        return set()
    prior = rows[:-1]
    flags = evaluate_flags(
        inventory_yoy=compute.compute_metric_series(_series(prior, "inventory"), "ratio").yoy,
        median_sale_price_yoy=compute.compute_metric_series(_series(prior, "median_sale_price"), "ratio").yoy,
        median_sale_price_high_36m=None,
        median_sale_price_low_36m=None,
        price_drops_yoy=None,
        price_drops_high_36m=None,
        median_dom_yoy=None,
        months_of_supply_value=None,
        months_of_supply_prior=None,
        zori_yoy=None,
        zhvi_yoy=None,
        permits_yoy_12m=None,
        payment_change_pct=None,
        thresholds=thresholds,
    )
    return {f.id for f in flags if f.severity == "major"}


def json_size(obj: BaseModel | dict[str, Any]) -> int:
    """Bytes as agents_core.publish writes them (compact JSON, UTF-8)."""
    data = obj.model_dump(mode="json") if isinstance(obj, BaseModel) else obj
    return len(json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode())


# ---- stage outputs -----------------------------------------------------------


@dataclass
class Fetched:
    metros: list[Metro]
    settings: Settings
    metro_fetch: fetch_redfin.FetchResult
    national_fetch: fetch_redfin.FetchResult
    zhvi_long: pl.DataFrame | None = None
    zori_long: pl.DataFrame | None = None
    permits_long: pl.DataFrame | None = None
    income_by_cbsa: dict[str, int] = field(default_factory=dict)
    income_year: int | None = None
    fred_series: dict[str, list[dict[str, str]]] = field(default_factory=dict)
    fred_changed: bool = False
    any_source_changed: bool = False
    sources: list[Source] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class MetroComputed:
    metro: Metro
    rows: list[dict[str, Any]]
    changes: dict[str, compute.MetricChange]
    permits: dict[str, dict[str, float | None]]
    data_through: date | None
    temperature: temperature_mod.Temperature
    affordability: compute.Affordability | None
    flags: list[Flag]
    facts: dict[str, Any]
    new_major_flags: list[Flag] = field(default_factory=list)


@dataclass
class Computed:
    fetched: Fetched
    metros: dict[str, MetroComputed]
    global_data_through: date | None
    national_changes: dict[str, compute.MetricChange]
    national_temperature: temperature_mod.Temperature
    national_series: dict[str, list[Any]]
    rates: NationalRates
    rates_as_of: date | None
    construction: NationalConstruction
    case_shiller: CaseShiller
    alerts: list[AlertOut]
    movers: Movers
    price_drops_count: int
    headline: str
    key_stats: list[KeyStat]
    national_facts: dict[str, Any]
    m30_latest: tuple[str, float] | None
    world: investigate.World | None = None
    targets: list[investigate.Target] = field(default_factory=list)


# ---- the agent -------------------------------------------------------------


class RealEstateAgent(Agent):
    id = AGENT_NAME
    name = "Real Estate Market Agent"
    route = "/real-estate"
    schema_version = "1.2.0"  # 1.1.0: §6.3 investigations, alert figures; 1.2.0: metros[].spark (additive)
    expected_interval_hours = 168
    next_run_hint = "Fridays 08:00 PT"
    history_keep = 52
    output_model = IndexOutput

    def configure_http(self, http: Http) -> None:
        # FRED allows 120 requests/minute; stay well under it.
        http.set_policy("api.stlouisfed.org", HostPolicy(min_interval_seconds=0.6))
        http.set_policy("api.census.gov", HostPolicy(min_interval_seconds=0.5))

    # -- fetch ---------------------------------------------------------------

    def fetch(self, ctx: RunContext) -> Fetched:
        metros = load_metros()
        settings = load_settings()
        state = state_mod.State.load()
        now = datetime.now(UTC)
        http = ctx.http

        with tracing.span("custom", "fetch:redfin") as sp:
            metro_fetch, national_fetch = fetch_redfin.fetch_all(
                http, tracked_regions={m.redfin_region for m in metros}, history_months=HISTORY_MONTHS
            )
            sp.set(
                source=metro_fetch.source,
                metro_modified=metro_fetch.modified,
                national_modified=national_fetch.modified,
                data_through=metro_fetch.data_through,
            )
        for warning in (*metro_fetch.warnings, *national_fetch.warnings):
            ctx.warn(warning)
        out = Fetched(
            metros=metros,
            settings=settings,
            metro_fetch=metro_fetch,
            national_fetch=national_fetch,
            any_source_changed=metro_fetch.modified or national_fetch.modified,
            warnings=ctx.warnings,  # published as meta.warnings; also printed by --dry-run
        )
        labels = {
            fetch_redfin.METRO_URL: "Redfin Data Center: housing market, metros",
            fetch_redfin.PRICE_DROPS_METRO_URL: "Redfin Data Center: price drops, metros",
            fetch_redfin.NATIONAL_URL: "Redfin Data Center: housing market, national",
            fetch_redfin.PRICE_DROPS_NATIONAL_URL: "Redfin Data Center: price drops, national",
            fetch_redfin.LEGACY_METRO_URL: "Redfin metro market tracker (legacy)",
            fetch_redfin.LEGACY_NATIONAL_URL: "Redfin national market tracker (legacy)",
        }
        out.sources += [
            Source(name=labels.get(url, url), url=url, retrieved_at=now)
            for url in (*metro_fetch.urls, *national_fetch.urls)
        ]

        region_ids = {m.zillow_region_id for m in metros if m.zillow_region_id is not None}
        if region_ids:
            try:
                zhvi_dl = fetch_zillow.download_zhvi(http)
                out.zhvi_long = fetch_zillow.load_long(
                    fetch_zillow.ZHVI_CSV_PATH, "zhvi", region_ids, HISTORY_MONTHS + 4
                )
                out.any_source_changed |= zhvi_dl.modified
                out.sources.append(Source(name="Zillow ZHVI", url=fetch_zillow.ZHVI_URL, retrieved_at=now))
            except Exception as exc:  # noqa: BLE001 - optional source, degrade per SPEC §10
                ctx.warn(f"zhvi fetch/parse failed: {exc}")
            try:
                zori_dl = fetch_zillow.download_zori(http)
                out.zori_long = fetch_zillow.load_long(
                    fetch_zillow.ZORI_CSV_PATH, "zori", region_ids, HISTORY_MONTHS + 4
                )
                out.any_source_changed |= zori_dl.modified
                out.sources.append(Source(name="Zillow ZORI", url=fetch_zillow.ZORI_URL, retrieved_at=now))
            except Exception as exc:  # noqa: BLE001
                ctx.warn(f"zori fetch/parse failed: {exc}")

        if settings.use_permits:
            # fetch_permits.py's parser is ready, but the exact monthly Census BPS
            # file layout/URL hasn't been verified against a live file (see its
            # docstring); degrade to null permits per SPEC §10 rather than guess.
            ctx.warn(
                "permits fetch skipped: the Census BPS monthly CBSA file URL/layout is unverified"
            )

        if settings.use_acs_income:
            out.income_by_cbsa, out.income_year = fetch_income.load_cached()
            acs_error = ""
            # ACS 1-year releases each September; try the latest year, then the one before.
            for year in (date.today().year - 1, date.today().year - 2):
                if out.income_year is not None and out.income_year >= year:
                    break
                try:
                    fresh = fetch_income.fetch_income_by_cbsa(http, year)
                except Exception as exc:  # noqa: BLE001 - optional source
                    ctx.log.info("ACS %d income unavailable: %s", year, exc)
                    acs_error = str(exc)
                    continue
                out.income_by_cbsa, out.income_year = fresh, year
                fetch_income.save_cache(fresh, year)
                break
            if out.income_by_cbsa:
                out.sources.append(
                    Source(
                        name=f"Census ACS {out.income_year} 1-year median household income",
                        url=f"https://api.census.gov/data/{out.income_year}/acs/acs1",
                        retrieved_at=now,
                    )
                )
            else:
                ctx.warn(f"ACS income unavailable; payment_to_income is null: {acs_error}")

        try:
            out.fred_series = fetch_fred.fetch_all_national(http)
            out.sources.append(Source(name="FRED", url="https://fred.stlouisfed.org/", retrieved_at=now))
            prior_m30 = state.sources.get("fred", {}).get("MORTGAGE30US")
            latest_m30 = fetch_fred.latest_value(out.fred_series.get("mortgage30", []))
            if latest_m30 and f"{latest_m30[0]}:{latest_m30[1]}" != prior_m30:
                out.fred_changed = True
                out.any_source_changed = True
        except Exception as exc:  # noqa: BLE001 - degrade rather than fail the whole run
            ctx.warn(f"FRED fetch failed: {exc}")
        return out

    # -- transform -------------------------------------------------------------

    def transform(self, ctx: RunContext, raw: Fetched) -> Computed:
        metros, settings = raw.metros, raw.settings
        metro_df = transform.build_metro_frame(
            pl.scan_parquet(raw.metro_fetch.parquet_path).collect(),
            metros,
            raw.zhvi_long,
            raw.zori_long,
            raw.permits_long,
        )
        national_rows = (
            pl.scan_parquet(raw.national_fetch.parquet_path).sort("period_end").collect().to_dicts()
        )
        global_data_through = national_rows[-1]["period_end"] if national_rows else None
        lag = compute.source_lag_warning(
            "Redfin", global_data_through, date.today(), settings.redfin_stale_after_days
        )
        if lag:
            ctx.warn(lag)

        rows_by_slug: dict[str, list[dict[str, Any]]] = {}
        changes_by_slug: dict[str, dict[str, compute.MetricChange]] = {}
        permits_by_slug: dict[str, dict[str, dict[str, float | None]]] = {}
        for m in metros:
            rows = metro_df.filter(pl.col("slug") == m.slug).sort("period_end").to_dicts()
            rows_by_slug[m.slug] = rows
            changes_by_slug[m.slug], permits_by_slug[m.slug] = _compute_metro_metrics(rows)
            if not rows:
                ctx.warn(f"{m.slug}: missing from the latest Redfin data; publishing stale")

        for key in STANDARD_METRO_KEYS:
            compute.add_percentile_ranks({slug: changes_by_slug[slug][key] for slug in changes_by_slug})

        temperatures = temperature_mod.compute_temperatures(
            {
                slug: {comp: changes[comp].value if comp in changes else None for comp in TEMPERATURE_COMPONENT_KEYS}
                for slug, changes in changes_by_slug.items()
            },
            settings.temperature_min_components,
            settings.temperature_bands,
        )

        # -- FRED-derived national figures ------------------------------------
        def fred_obs(key: str) -> list[dict[str, str]]:
            return raw.fred_series.get(key, [])

        def fred_pairs(key: str) -> list[tuple[date, float]]:
            return [(date.fromisoformat(o["date"]), float(o["value"])) for o in fred_obs(key)]

        m30_obs = fred_obs("mortgage30")
        m30_latest = fetch_fred.latest_value(m30_obs)
        m30_prev = float(m30_obs[-2]["value"]) if len(m30_obs) >= 2 else None
        m30_change_1w = (
            round(m30_latest[1] - m30_prev, 2) if (m30_latest and m30_prev is not None) else None
        )
        m30_year_ago = fetch_fred.value_n_days_before(m30_obs, 364) if m30_obs else None
        rates_as_of = date.fromisoformat(m30_latest[0]) if m30_latest else global_data_through

        m15_by_date, m30_by_date = dict(fred_pairs("mortgage15")), dict(fred_pairs("mortgage30"))
        rate_dates = sorted(set(m30_by_date) | set(m15_by_date))[-156:]  # ~3 years weekly
        rates = NationalRates(
            dates=[d.isoformat() for d in rate_dates],
            mortgage30=[m30_by_date.get(d) for d in rate_dates],
            mortgage15=[m15_by_date.get(d) for d in rate_dates],
            latest=RatesLatest(
                mortgage30=m30_latest[1] if m30_latest else None,
                mortgage30_change_1w_pp=m30_change_1w,
                mortgage30_year_ago=m30_year_ago,
            ),
        )

        def construction_value(key: str) -> ConstructionSeriesValue:
            change = compute.compute_metric_series(fred_pairs(key), "ratio")
            return ConstructionSeriesValue(
                value=change.value,
                mom=change.mom,
                units="thousands, SAAR",
                period=fred_obs(key)[-1]["date"] if fred_obs(key) else None,
            )

        # The construction series share one `dates` array (§6 rules): align on dates.
        starts_by_date, permits_nat_by_date = dict(fred_pairs("housing_starts")), dict(fred_pairs("permits_national"))
        construction_dates = sorted(set(starts_by_date) | set(permits_nat_by_date))[-HISTORY_MONTHS:]
        construction = NationalConstruction(
            housing_starts=construction_value("housing_starts"),
            permits=construction_value("permits_national"),
            series={
                "dates": [d.isoformat() for d in construction_dates],
                "housing_starts": [starts_by_date.get(d) for d in construction_dates],
                "permits": [permits_nat_by_date.get(d) for d in construction_dates],
            },
        )
        cs_change = compute.compute_metric_series(fred_pairs("case_shiller"), "ratio")
        case_shiller = CaseShiller(
            value=cs_change.value,
            yoy=cs_change.yoy,
            period=fred_obs("case_shiller")[-1]["date"] if fred_obs("case_shiller") else None,
        )

        # -- national Redfin-derived metrics -------------------------------------
        national_changes = {
            key: compute.compute_metric_series(
                _series(national_rows, key), metric_registry.get(key).change_kind, history_months=HISTORY_MONTHS
            )
            for key in NATIONAL_REDFIN_KEYS
        }
        national_history = {
            comp: [v for _d, v in _series(national_rows, comp) if v is not None][-HISTORY_MONTHS:]
            for comp in TEMPERATURE_COMPONENT_KEYS
        }
        national_temperature = temperature_mod.compute_temperature_own_history(
            {comp: national_changes[comp].value for comp in TEMPERATURE_COMPONENT_KEYS},
            national_history,
            settings.temperature_min_components,
            settings.temperature_bands,
        )
        national_dates = compute.month_end_dates(global_data_through, HISTORY_MONTHS) if global_data_through else []
        national_series: dict[str, list[Any]] = {"dates": [d.isoformat() for d in national_dates]}
        for key in NATIONAL_SERIES_KEYS:
            national_series[key] = compute.series_for_dates(_series(national_rows, key), national_dates)

        # -- per-metro flags, affordability, facts -------------------------------
        computed_metros: dict[str, MetroComputed] = {}
        for m in metros:
            c, p, rows = changes_by_slug[m.slug], permits_by_slug[m.slug], rows_by_slug[m.slug]
            affordability: compute.Affordability | None = None
            if m30_latest and c["median_sale_price"].value is not None:
                income = raw.income_by_cbsa.get(m.cbsa) if m.cbsa else None
                affordability = compute.compute_affordability(
                    price_now=c["median_sale_price"].value,
                    price_year_ago=compute.value_at_offset(_series(rows, "median_sale_price"), 12),
                    rate_now=m30_latest[1],
                    rate_year_ago=m30_year_ago,
                    median_household_income=income,
                    income_year=raw.income_year if income else None,
                )
            flag_list = evaluate_flags(
                inventory_yoy=c["inventory"].yoy,
                median_sale_price_yoy=c["median_sale_price"].yoy,
                median_sale_price_high_36m=c["median_sale_price"].high_36m,
                median_sale_price_low_36m=c["median_sale_price"].low_36m,
                price_drops_yoy=c["price_drops"].yoy,
                price_drops_high_36m=c["price_drops"].high_36m,
                median_dom_yoy=c["median_dom"].yoy,
                months_of_supply_value=c["months_of_supply"].value,
                months_of_supply_prior=compute.value_at_offset(_series(rows, "months_of_supply"), 1),
                zori_yoy=c["zori"].yoy,
                zhvi_yoy=c["zhvi"].yoy,
                permits_yoy_12m=p["permits_total"]["yoy_12m"],
                payment_change_pct=affordability.payment_change_pct if affordability else None,
                thresholds=settings.flags,
            )
            data_through = rows[-1]["period_end"] if rows else None
            shown_through = data_through or global_data_through
            temp = temperatures[m.slug]
            facts = analyze.build_metro_facts(
                metro_name=m.name,
                data_through=shown_through.strftime("%B %Y") if shown_through else "",
                median_sale_price=c["median_sale_price"].to_dict(),
                inventory=c["inventory"].to_dict(),
                median_dom=c["median_dom"].to_dict(),
                price_drops=c["price_drops"].to_dict(),
                sale_to_list=c["avg_sale_to_list"].to_dict(),
                months_of_supply_value=c["months_of_supply"].value,
                months_of_supply_yoy=c["months_of_supply"].yoy,
                zori=c["zori"].to_dict(),
                temperature_label=temp.label,
                temperature_score=temp.score,
                market_type=temperature_mod.market_type(c["months_of_supply"].value),
                flag_labels=[f.label for f in flag_list],
                mortgage30_pct=m30_latest[1] if m30_latest else None,
                mortgage30_year_ago_pct=m30_year_ago,
                payment_now=affordability.payment_now if affordability else None,
                payment_change_pct=affordability.payment_change_pct if affordability else None,
            )
            prior_major = _prior_major_flag_ids(rows, settings.flags)
            computed_metros[m.slug] = MetroComputed(
                metro=m,
                rows=rows,
                changes=c,
                permits=p,
                data_through=data_through,
                temperature=temp,
                affordability=affordability,
                flags=flag_list,
                facts=facts,
                new_major_flags=[f for f in flag_list if f.severity == "major" and f.id not in prior_major],
            )

        # -- alerts, movers, headline ------------------------------------------
        alerts = [
            AlertOut.model_validate(a)
            for a in build_alerts(
                {slug: mc.flags for slug, mc in computed_metros.items()},
                {slug: mc.metro.name for slug, mc in computed_metros.items()},
                settings.flags,
            )
        ]

        raw_movers = movers_mod.compute_movers(
            [
                {
                    "slug": slug,
                    "name": mc.metro.name,
                    "homes_sold_12m": compute.trailing_sum(_series(mc.rows, "homes_sold")),
                    "median_sale_price_yoy": mc.changes["median_sale_price"].yoy,
                    "inventory_yoy": mc.changes["inventory"].yoy,
                    "temperature_score": mc.temperature.score,
                }
                for slug, mc in computed_metros.items()
            ]
        )
        mover_value_key = {
            "price_gains": "median_sale_price_yoy",
            "price_declines": "median_sale_price_yoy",
            "inventory_growth": "inventory_yoy",
            "temperature_top": "temperature_score",
            "temperature_bottom": "temperature_score",
        }
        movers = Movers(
            **{
                group: [MoverEntry(slug=e["slug"], name=e["name"], value=e[mover_value_key[group]]) for e in entries]
                for group, entries in raw_movers.items()
            }
        )

        price_drops_count = sum(1 for c in changes_by_slug.values() if (c["price_drops"].yoy or 0) > 0)
        headline = templates.headline(
            inventory_national_yoy=national_changes["inventory"].yoy,
            price_national_yoy=national_changes["median_sale_price"].yoy,
            price_drops_count=price_drops_count,
            total_metros=len(metros),
        )
        key_stats = [
            KeyStat(
                label="US median sale price",
                value=national_changes["median_sale_price"].value,
                format="currency_compact",
                delta=national_changes["median_sale_price"].yoy,
                delta_format="percent_signed",
            ),
            KeyStat(
                label="30-yr mortgage",
                value=m30_latest[1] if m30_latest else None,
                format="percent",
                delta=m30_change_1w,
                delta_format="pp_signed",
            ),
        ]
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
                "price_drops_share_pct": {
                    "value": analyze.to_pct(national_changes["price_drops"].value),
                    "yoy_pp": analyze.to_pct(national_changes["price_drops"].yoy),
                },
                "median_dom": {
                    "value": national_changes["median_dom"].value,
                    "yoy_days": national_changes["median_dom"].yoy,
                },
            },
            "temperature": {
                "label": national_temperature.label,
                "score": national_temperature.score,
                "relative_to": "its own 3-year history",
            },
            "rates": {
                "mortgage30_pct": m30_latest[1] if m30_latest else None,
                "mortgage30_year_ago_pct": m30_year_ago,
                "mortgage30_change_1w_pp": m30_change_1w,
            },
        }

        world = self._build_world(
            computed_metros, global_data_through, national_series, national_temperature, rates
        )
        targets = investigate.select_targets(
            world,
            {
                slug: [investigate.WorldFlag(id=f.id, label=f.label, severity=f.severity) for f in mc.new_major_flags]
                for slug, mc in computed_metros.items()
            },
            {slug: mc.changes["median_sale_price"].yoy for slug, mc in computed_metros.items()},
        )

        return Computed(
            fetched=raw,
            metros=computed_metros,
            global_data_through=global_data_through,
            national_changes=national_changes,
            national_temperature=national_temperature,
            national_series=national_series,
            rates=rates,
            rates_as_of=rates_as_of,
            construction=construction,
            case_shiller=case_shiller,
            alerts=alerts,
            movers=movers,
            price_drops_count=price_drops_count,
            headline=headline,
            key_stats=key_stats,
            national_facts=national_facts,
            m30_latest=m30_latest,
            world=world,
            targets=targets,
        )

    def _build_world(
        self,
        metros: dict[str, MetroComputed],
        global_through: date | None,
        national_series: dict[str, list[Any]],
        national_temperature: temperature_mod.Temperature,
        rates: NationalRates,
    ) -> investigate.World:
        """The investigator's read-only snapshot (§6.3): the same computed series
        the metro files publish, so its tools never see a number the site doesn't."""
        world_metros = {}
        for slug, mc in metros.items():
            series = self._metro_series(mc, global_through, HISTORY_MONTHS)
            world_metros[slug] = investigate.WorldMetro(
                slug=slug,
                name=mc.metro.name,
                region=investigate.region_for(mc.metro.name),
                homes_sold_12m=compute.trailing_sum(_series(mc.rows, "homes_sold")),
                dates=series["dates"],
                series={k: series[k] for k in investigate.METRIC_KEYS if k in series},
                flags=[investigate.WorldFlag(id=f.id, label=f.label, severity=f.severity) for f in mc.flags],
            )
        return investigate.World(
            data_through=(global_through or date.today()).isoformat(),
            metros=world_metros,
            national_dates=national_series.get("dates", []),
            national_series={k: v for k, v in national_series.items() if k != "dates"},
            national_temperature={
                "label": national_temperature.label,
                "score": national_temperature.score,
                "relative_to": "its own 3-year history",
            },
            rate_dates=rates.dates,
            mortgage30=rates.mortgage30,
        )

    def summarize_dry_run(self, data: Computed) -> str:
        lines = [f"{'slug':<22}{'price':>12}{'yoy':>8}{'inv_yoy':>10}{'temp':>6}  flags"]
        for slug, mc in data.metros.items():
            price, inv = mc.changes["median_sale_price"], mc.changes["inventory"]
            lines.append(
                f"{slug:<22}"
                f"{f'{price.value:,.0f}' if price.value is not None else '-':>12}"
                f"{f'{price.yoy:+.1%}' if price.yoy is not None else '-':>8}"
                f"{f'{inv.yoy:+.1%}' if inv.yoy is not None else '-':>10}"
                f"{mc.temperature.score if mc.temperature.score is not None else '-':>6}"
                f"  {','.join(f.id for f in mc.flags)}"
            )
        lines.append(f"headline: {data.headline}")
        lines += [f"investigate: {t.slug} ({t.trigger}: {t.trigger_label})" for t in data.targets]
        lines += [f"warning: {w}" for w in data.fetched.warnings]
        return "\n" + "\n".join(lines)

    # -- analyze ---------------------------------------------------------------

    def analyze(self, ctx: RunContext, data: Computed) -> AgentResult:
        raw, settings = data.fetched, data.fetched.settings
        force_briefs = FORCE_BRIEFS_FLAG in ctx.extra_args
        state = state_mod.State.load()
        previous = state_mod.Previous.load()
        any_changed = raw.any_source_changed
        llm_ok = llm_available(ctx.llm)
        if not llm_ok:
            ctx.warn(NO_KEY_WARNING)

        # -- metro briefs: reuse the previous output on an unchanged facts hash --------
        briefs: dict[str, Brief] = {}
        to_generate: dict[str, dict[str, Any]] = {}
        hashes: dict[str, str] = {}
        with tracing.span("custom", "metro_briefs") as sp:
            for slug, mc in data.metros.items():
                changed, hashes[slug] = state_mod.facts_changed(state, slug, analyze.metro_cache_facts(mc.facts))
                any_changed |= changed
                prior = None if force_briefs else self._reuse(state.brief_hashes, slug, hashes[slug], previous.brief(slug))
                if prior is not None:
                    briefs[slug] = prior
                else:
                    to_generate[slug] = mc.facts
            ctx.log.info("metro briefs: %d reused, %d to generate", len(briefs), len(to_generate))
            if llm_ok:
                generated, batch_fallback = analyze.llm_metro_briefs(
                    ctx.llm, to_generate, batch_timeout_seconds=settings.batch_poll_timeout_min * 60
                )
                if batch_fallback:
                    ctx.warn("metro brief batch timed out; agents-core reran it synchronously")
                for slug, brief in generated.items():
                    briefs[slug] = brief
                    state.brief_hashes[slug] = hashes[slug]
            else:
                for slug, facts in to_generate.items():
                    briefs[slug] = analyze.generate_metro_brief(facts, reused=False)
                    state.brief_hashes.pop(slug, None)  # regenerate once a key is set
            sp.set(reused=len(data.metros) - len(to_generate), generated=len(to_generate), llm=llm_ok)

        # -- national brief ------------------------------------------------------------
        alerts_dicts = [a.model_dump() for a in data.alerts]
        mover_counts = {"have more price cuts than a year ago": data.price_drops_count}
        national_input = analyze.build_national_input(
            data.national_facts,
            alerts_dicts,
            data.movers.model_dump(include={"price_gains", "price_declines", "inventory_growth"}),
            mover_counts,
            total_metros=len(data.metros),
        )
        with tracing.span("custom", "national_brief") as sp:
            national_changed, national_hash = state_mod.facts_changed(state, "national", national_input)
            prior_national = (
                None
                if force_briefs
                else self._reuse(state.brief_hashes, "national", national_hash, previous.brief("national"))
            )
            if prior_national is not None:
                national_brief = prior_national
            elif llm_ok:
                any_changed |= national_changed
                national_brief = analyze.llm_national_brief(
                    ctx.llm,
                    national_input,
                    lambda: analyze.template_national_draft(data.national_facts, alerts_dicts, mover_counts),
                )
                state.brief_hashes["national"] = national_hash
            else:
                any_changed |= national_changed
                national_brief = analyze.generate_national_brief(data.national_facts, alerts_dicts, mover_counts)
                state.brief_hashes.pop("national", None)
            sp.set(reused=prior_national is not None, narrative_source=national_brief.narrative_source)

        # -- metro investigations (§6.3): an agent loop per target ---------------------
        investigations: dict[str, Investigation] = {}
        new_hashes: dict[str, str] = {}
        if data.world is not None and data.targets:
            world_hash = state_mod.hash_facts(
                {"world": data.world.model_dump(mode="json"), "prompt_version": investigate.PROMPT_VERSION}
            )
            with tracing.span("custom", "investigations", targets=[t.slug for t in data.targets]) as sp:
                for target in data.targets:
                    inv_hash = state_mod.hash_facts({"world": world_hash, "target": target.model_dump()})
                    prior = (
                        None
                        if force_briefs
                        else state_mod.reusable(
                            state.investigation_hashes, target.slug, inv_hash, previous.investigation(target.slug)
                        )
                    )
                    investigation = self._reuse_investigation(prior)
                    if investigation is not None:
                        new_hashes[target.slug] = inv_hash
                    else:
                        any_changed = True
                        investigation, reusable_later = self._investigate(ctx, data.world, target, llm_ok)
                        if reusable_later:
                            new_hashes[target.slug] = inv_hash
                    investigations[target.slug] = investigation
                sp.set(
                    reused=sum(i.reused for i in investigations.values()),
                    llm=sum(i.narrative_source == "llm" for i in investigations.values()),
                )
        state.investigation_hashes = new_hashes

        # -- assemble ---------------------------------------------------------------------
        files: dict[str, BaseModel] = {}
        summaries: list[MetroSummary] = []
        for slug, mc in data.metros.items():
            summary, detail = self._metro_outputs(mc, briefs[slug], data.global_data_through)
            detail.investigation = investigations.get(slug)
            if json_size(detail) > settings.max_metro_kb * 1024:
                ctx.warn(f"{slug}: metro file too large, trimming to {TRIMMED_HISTORY_MONTHS} months")
                detail.series = self._metro_series(mc, data.global_data_through, TRIMMED_HISTORY_MONTHS)
                if json_size(detail) > settings.max_metro_kb * 1024:
                    raise PublishSizeError(f"metros/{slug}.json is {json_size(detail)} bytes after trimming")
            summaries.append(summary)
            files[f"metros/{slug}.json"] = detail

        body = self._index_body(data, national_brief, summaries)
        body["investigations"] = [self._investigation_summary(i) for i in investigations.values()]
        limit = int(settings.max_index_kb * 1024) - INDEX_SIZE_MARGIN_BYTES
        body, size_warnings = fit_index(body, lambda b: self._index_size(ctx, b, raw.sources), limit)
        for w in size_warnings:
            ctx.warn(w)

        # -- run state (committed back to the default branch by run-agent.yml) ------------
        state.sources["redfin_metro"] = {"data_through": raw.metro_fetch.data_through}
        state.sources["redfin_national"] = {"data_through": raw.national_fetch.data_through}
        if data.m30_latest:
            state.sources.setdefault("fred", {})["MORTGAGE30US"] = f"{data.m30_latest[0]}:{data.m30_latest[1]}"
        state.save()

        return AgentResult(
            body=body,
            sources=raw.sources,
            headline=data.headline,
            key_stats=data.key_stats,
            data_changed=any_changed,
            items_count=len(data.metros),
            files=files,
        )

    # -- narrative reuse and investigations ------------------------------------------

    @staticmethod
    def _reuse(hashes: dict[str, str], key: str, facts_hash: str, prior: dict[str, Any] | None) -> Brief | None:
        """The previous published brief for `key`, if it came from these facts."""
        found = state_mod.reusable(hashes, key, facts_hash, prior)
        if found is None:
            return None
        try:
            return analyze.reuse_brief(found)
        except ValidationError:
            return None

    @staticmethod
    def _reuse_investigation(prior: dict[str, Any] | None) -> Investigation | None:
        if prior is None:
            return None
        try:
            return Investigation.model_validate({**prior, "reused": True})
        except ValidationError:
            return None

    @staticmethod
    def _investigate(
        ctx: RunContext, world: investigate.World, target: investigate.Target, llm_ok: bool
    ) -> tuple[Investigation, bool]:
        """Runs the investigator loop for one target. Returns the investigation and
        whether it may be reused on unchanged data (not when it's a template because
        the key was missing or the loop stopped early: those retry next run)."""
        slug = target.slug

        def template(result: Any = None) -> Investigation:
            draft = investigate.template_investigation(world, target)
            return Investigation.model_validate(investigate.investigation_record(target, result, draft, "template"))

        if not llm_ok:
            return template(), False
        try:
            result = investigate.run_investigation(ctx.llm, world, target)
        except LLMError as exc:
            ctx.warn(f"investigation {slug}: unusable LLM response ({exc}); published the template")
            return template(), False
        if result.ok and result.result is not None:
            source = result.narrative_source or "llm"
            if source == "template":
                ctx.warn(f"investigation {slug}: number guard failed after a retry; published the template")
            record = investigate.investigation_record(target, result, result.result, source)
            return Investigation.model_validate(record), True
        ctx.warn(f"investigation {slug} stopped ({result.stop_reason}) after {result.steps} steps; published the template")
        return template(result), False

    @staticmethod
    def _investigation_summary(inv: Investigation) -> InvestigationSummary:
        first = investigate.first_sentence(inv.explanation)
        return InvestigationSummary(
            slug=inv.slug,
            name=inv.name,
            trigger=inv.trigger,
            trigger_label=inv.trigger_label,
            summary=first[:240],
            cited_metrics=inv.cited_metrics,
            narrative_source=inv.narrative_source,
            stop_reason=inv.stop_reason,
        )

    # -- assembly helpers ---------------------------------------------------------

    @staticmethod
    def _metro_series(mc: MetroComputed, global_through: date | None, months: int) -> dict[str, list[Any]]:
        through = mc.data_through or global_through
        dates = compute.month_end_dates(through, months) if through else []
        series: dict[str, list[Any]] = {"dates": [d.isoformat() for d in dates]}
        for key in metric_registry.METRO_METRIC_KEYS:
            series[key] = compute.series_for_dates(_series(mc.rows, key), dates)
        return series

    def _metro_outputs(
        self, mc: MetroComputed, brief: Brief, global_through: date | None
    ) -> tuple[MetroSummary, MetroDetailOutput]:
        m, c, p = mc.metro, mc.changes, mc.permits
        summary_latest: dict[str, MetricSummaryValue | PermitsValue] = {
            key: _summary_metric(c[key]) for key in STANDARD_METRO_KEYS
        }
        detail_latest: dict[str, MetricValue | PermitsValue] = {
            key: _detail_metric(c[key], metric_registry.get(key).delta_format) for key in STANDARD_METRO_KEYS
        }
        for key in PERMIT_KEYS:
            summary_latest[key] = detail_latest[key] = PermitsValue(**p[key])

        aff = mc.affordability
        affordability_out = (
            AffordabilityOut(
                payment_now=aff.payment_now,
                payment_year_ago=aff.payment_year_ago,
                payment_change_pct=aff.payment_change_pct,
                payment_to_income=aff.payment_to_income,
                median_household_income=aff.median_household_income,
                income_year=aff.income_year,
                assumptions=aff.assumptions,
            )
            if aff is not None
            else None
        )
        stale = not mc.rows or (global_through is not None and mc.data_through != global_through)
        market_type = temperature_mod.market_type(c["months_of_supply"].value)
        temp = mc.temperature
        summary = MetroSummary(
            slug=m.slug,
            name=m.name,
            cbsa=m.cbsa,
            lat=m.lat,
            lon=m.lon,
            homes_sold_12m=compute.trailing_sum(_series(mc.rows, "homes_sold")),
            latest=summary_latest,
            temperature=TemperatureSummary(score=temp.score, label=temp.label),
            market_type=market_type,
            flags=[f.id for f in mc.flags],
            brief_excerpt=brief.text.split(". ")[0][:160] if brief.text else "",
            stale=stale,
            spark=spark_series(mc.rows, mc.data_through or global_through),
        )
        detail = MetroDetailOutput(
            slug=m.slug,
            name=m.name,
            cbsa=m.cbsa,
            lat=m.lat,
            lon=m.lon,
            data_through=mc.data_through or global_through or date.today(),
            latest=detail_latest,
            temperature=TemperatureDetail(score=temp.score, label=temp.label, components=temp.components),
            market_type=market_type,
            flags=[FlagOut(id=f.id, label=f.label, severity=f.severity, facts=f.facts) for f in mc.flags],
            affordability=affordability_out,
            series=self._metro_series(mc, global_through, HISTORY_MONTHS),
            brief=brief,
            stale=stale,
        )
        return summary, detail

    @staticmethod
    def _index_body(data: Computed, national_brief: Brief, summaries: list[MetroSummary]) -> dict[str, Any]:
        through = data.global_data_through or date.today()
        return {
            "headline": data.headline,
            "key_stats": data.key_stats,
            "data_through": through,
            "rates_as_of": data.rates_as_of or through,
            "metric_registry": [MetricRegistryEntry(**d) for d in metric_registry.registry_for_site()],
            "national": NationalBlock(
                latest={
                    key: _detail_metric(data.national_changes[key], metric_registry.get(key).delta_format)
                    for key in NATIONAL_REDFIN_KEYS
                },
                temperature=TemperatureSummary(
                    score=data.national_temperature.score,
                    label=data.national_temperature.label,
                    basis="vs its own 3-year history",
                ),
                series=data.national_series,
                rates=data.rates,
                construction=data.construction,
                case_shiller=data.case_shiller,
                brief=national_brief,
            ),
            "metros": summaries,
            "movers": data.movers,
            "alerts": data.alerts,
            "sources": INDEX_SOURCES,
        }

    def _index_size(self, ctx: RunContext, body: dict[str, Any], sources: list[Source]) -> int:
        """latest.json's size with a representative `meta` block (the runner adds
        the real one after `analyze`; it differs only in a few digits)."""
        meta = RunMeta(
            warnings=list(ctx.warnings),
            agent=self.id,
            schema_version=self.schema_version,
            run_id=ctx.run_id,
            started_at=ctx.started_at,
            finished_at=datetime.now(UTC),
            status="ok",
            data_changed=True,
            cost_usd=round(ctx.costs.total_usd, 6),
            model_usage=ctx.costs.model_usage(),
            sources=sources,
        )
        return json_size(IndexOutput.model_validate({**body, "meta": meta}))


AGENT = RealEstateAgent()
