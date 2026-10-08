"""Metro investigator: a budgeted tool-use loop (`agents_core.agent_loop`) that
explains *why* a metro is moving (SPEC_REAL_ESTATE.md §6.3).

Each run investigates up to `MAX_TARGETS` metros: those with a **new `major`
flag** this month (major now, not major a month earlier), largest markets
first; if there are none, the **top mover** (largest absolute median-sale-price
YoY). The model gets read-only tools over numbers Python already computed:

    get_metro_series(slug, metrics, months)   monthly history, human units
    compare_to_peers(slug, metric)            5 closest metros by homes sold, same Census region
    get_national_context(series)              national latest values and YoY
    get_rate_history(weeks)                   30-yr fixed mortgage rate, weekly
    find_similar_episodes(slug, metric)       past 36 months with a similar YoY move
    finish(explanation, cited_metrics)        4-6 sentences + the metrics it relies on

Numbers still come from Python: every tool returns values computed from the same
`World` snapshot the agent publishes, and the final explanation goes through the
number guard against *everything the tools returned* in that run (plus the task
facts), with `no_multiples=True`: no multiples or ratios the model computed. A failing explanation is retried once, then replaced by
`template_investigation` (`narrative_source: "template"`). Budgets: 8 model calls
and $0.05 per investigation (`LoopBudget`), inside the run's MAX_RUN_USD.

`World` is a plain, JSON-serializable snapshot, so the trajectory evals
(`evals/real_estate/suites.py`) run the same loop against fixture worlds.
"""

from __future__ import annotations

import json
import re
import statistics
from datetime import UTC, date, datetime
from typing import Any, Literal

from agents_core.agent_loop import AgentLoop, LoopBudget, LoopResult, ToolError, tool
from agents_core.guards import GuardResult, fields_guard, find_derived
from agents_core.llm import LLM, tier_config
from pydantic import BaseModel, Field, field_validator

from agents.real_estate import compute
from agents.real_estate import metrics as metric_registry
from agents.real_estate.analyze import GUARD_ALLOW, guard_facts

PROMPT_VERSION = "investigator-2026-10-08.5"
MAX_TARGETS = 3
TIER = "fast"
MAX_TOKENS = 1200
BUDGET = LoopBudget(max_steps=8, max_usd=0.05, max_seconds=180)
N_PEERS = 5
MIN_SENTENCES, MAX_SENTENCES = 4, 6
# The tools' own fixed windows (find_similar_episodes searches "the past 36 months").
GUARD_ALLOW_LOOP = (*GUARD_ALLOW, "36 months", "36-month")

MetricKey = Literal[
    "median_sale_price",
    "homes_sold",
    "new_listings",
    "inventory",
    "months_of_supply",
    "median_dom",
    "avg_sale_to_list",
    "sold_above_list",
    "price_drops",
    "off_market_in_two_weeks",
    "zhvi",
    "zori",
]
METRIC_KEYS: tuple[str, ...] = MetricKey.__args__  # type: ignore[attr-defined]
NationalKey = Literal[
    "median_sale_price",
    "inventory",
    "median_dom",
    "price_drops",
    "avg_sale_to_list",
    "months_of_supply",
    "homes_sold",
    "new_listings",
]
TOOL_NAMES = (
    "get_metro_series",
    "compare_to_peers",
    "get_national_context",
    "get_rate_history",
    "find_similar_episodes",
)

# Census Bureau regions, for "peers in the same region".
_REGIONS = {
    "Northeast": "CT ME MA NH RI VT NJ NY PA",
    "Midwest": "IL IN MI OH WI IA KS MN MO NE ND SD",
    "South": "DE DC FL GA MD NC SC VA WV AL KY MS TN AR LA OK TX",
    "West": "AZ CO ID MT NV NM UT WY AK CA HI OR WA",
}
STATE_REGION = {st: region for region, states in _REGIONS.items() for st in states.split()}


def region_for(metro_name: str) -> str | None:
    """"Houston, TX" -> "South"; multi-state names use the first state."""
    _, _, states = metro_name.rpartition(",")
    first = states.strip().split("-")[0].strip()
    return STATE_REGION.get(first)


# ---- the snapshot the tools read ------------------------------------------------


class WorldFlag(BaseModel):
    id: str
    label: str
    severity: str


class WorldMetro(BaseModel):
    slug: str
    name: str
    region: str | None
    homes_sold_12m: int | None
    # Month-end dates (ISO) and stored values (ratios for shares, as compute.py keeps them).
    dates: list[str]
    series: dict[str, list[float | None]]
    flags: list[WorldFlag] = Field(default_factory=list)


class World(BaseModel):
    data_through: str
    metros: dict[str, WorldMetro]
    national_dates: list[str]
    national_series: dict[str, list[float | None]]
    national_temperature: dict[str, Any] = Field(default_factory=dict)
    rate_dates: list[str] = Field(default_factory=list)
    mortgage30: list[float | None] = Field(default_factory=list)

    @property
    def has_rates(self) -> bool:
        return any(v is not None for v in self.mortgage30)


class Target(BaseModel):
    slug: str
    name: str
    trigger: Literal["new_major_flag", "top_mover"]
    trigger_flag: str | None = None
    trigger_label: str
    trigger_metric: str


# ---- units: tools speak the facts dicts' human units (§7.2) -----------------------


def _unit(key: str) -> str:
    m = metric_registry.get(key)
    return {
        "currency": "USD",
        "count": "count",
        "days": "days",
        "decimal1": "months" if key == "months_of_supply" else "index",
        "percent": "percent",
    }[m.format]


def _human(key: str, value: float | None) -> float | int | None:
    if value is None:
        return None
    fmt = metric_registry.get(key).format
    if fmt == "percent":
        return round(value * 100, 1)
    if fmt in ("currency", "count", "days"):
        return int(round(value))
    return round(value, 1)


def _change_key(key: str) -> str:
    m = metric_registry.get(key)
    if m.change_kind == "ratio":
        return "yoy_pct"
    if m.change_kind == "pp":
        return "yoy_pp"
    return f"yoy_{m.unit or 'change'}"


def _human_change(key: str, change: float | None) -> float | None:
    if change is None:
        return None
    if metric_registry.get(key).change_kind in ("ratio", "pp"):
        return round(change * 100, 1)
    return round(change, 1)


def _pairs(dates: list[str], values: list[float | None]) -> list[tuple[date, float | None]]:
    return [(date.fromisoformat(d), v) for d, v in zip(dates, values, strict=False)]


def _latest(key: str, dates: list[str], values: list[float | None]) -> dict[str, Any]:
    change = compute.compute_metric_series(
        _pairs(dates, values), metric_registry.get(key).change_kind
    )
    return {"value": _human(key, change.value), _change_key(key): _human_change(key, change.yoy)}


def _yoy_series(key: str, values: list[float | None]) -> list[float | None]:
    """YoY change per month (None for the first 12), in human units."""
    kind = metric_registry.get(key).change_kind
    out: list[float | None] = []
    for i, v in enumerate(values):
        prior = values[i - 12] if i >= 12 else None
        if v is None or prior is None:
            out.append(None)
        elif kind == "ratio":
            out.append(round((v / prior - 1) * 100, 1) if prior else None)
        else:
            out.append(_human_change(key, v - prior))
    return out


# ---- tools --------------------------------------------------------------------------


class SeriesQuery(BaseModel):
    slug: str = Field(description="Metro slug, e.g. 'phoenix-az'")
    metrics: list[MetricKey] = Field(min_length=1, max_length=5)
    months: int = Field(default=13, ge=3, le=36, description="How many recent months")


class PeerQuery(BaseModel):
    slug: str
    metric: MetricKey


class NationalQuery(BaseModel):
    series: list[NationalKey] = Field(min_length=1, max_length=6)


class RateQuery(BaseModel):
    weeks: int = Field(default=52, ge=4, le=156)


class EpisodeQuery(BaseModel):
    slug: str
    metric: MetricKey


class Toolbox:
    """The investigator's tools over one `World`. Every output is appended to
    `seen`, which the number guard checks the final explanation against."""

    def __init__(self, world: World) -> None:
        self.world = world
        self.seen: list[Any] = []

    def _metro(self, slug: str) -> WorldMetro:
        m = self.world.metros.get(slug)
        if m is None:
            raise ToolError(f"unknown metro slug {slug!r}")
        return m

    def _record(self, out: dict[str, Any]) -> dict[str, Any]:
        self.seen.append(out)
        return out

    def metro_series(self, q: SeriesQuery) -> dict[str, Any]:
        m = self._metro(q.slug)
        n = min(q.months, len(m.dates))
        out: dict[str, Any] = {"metro": m.name, "months": [d[:7] for d in m.dates[-n:]], "series": {}}
        for key in dict.fromkeys(q.metrics):
            values = m.series.get(key, [])
            if not any(v is not None for v in values):
                out["series"][key] = {"available": False}
                continue
            out["series"][key] = {
                "unit": _unit(key),
                "values": [_human(key, v) for v in values[-n:]],
                "latest": _latest(key, m.dates, values),
            }
        return self._record(out)

    def peers(self, q: PeerQuery) -> dict[str, Any]:
        m = self._metro(q.slug)
        same_region = [
            p
            for p in self.world.metros.values()
            if p.slug != m.slug and p.region == m.region and p.homes_sold_12m is not None
        ]
        size = m.homes_sold_12m or 0
        closest = sorted(same_region, key=lambda p: (abs((p.homes_sold_12m or 0) - size), p.slug))
        closest = closest[:N_PEERS]
        change_key = _change_key(q.metric)

        def row(x: WorldMetro) -> dict[str, Any]:
            return {
                "metro": x.name,
                "homes_sold_12m": x.homes_sold_12m,
                **_latest(q.metric, x.dates, x.series.get(q.metric, [])),
            }

        peer_rows = [row(p) for p in closest]
        changes = [r[change_key] for r in peer_rows if r.get(change_key) is not None]
        this = row(m)
        out = {
            "metric": q.metric,
            "region": m.region,
            "n_peers": len(peer_rows),
            "metro": this,
            "peers": peer_rows,
            f"peer_median_{change_key}": round(statistics.median(changes), 1) if changes else None,
        }
        if this.get(change_key) is not None and changes:
            above = sum(1 for c in changes if c > this[change_key])
            out["rank_vs_peers"] = above + 1
            out["rank_note"] = (
                f"1 = the largest change among this metro and its {len(peer_rows)} peers only"
                " (not the whole region)"
            )
        return self._record(out)

    def national(self, q: NationalQuery) -> dict[str, Any]:
        w = self.world
        out = {
            "data_through": w.data_through,
            "series": {
                key: _latest(key, w.national_dates, w.national_series.get(key, []))
                for key in dict.fromkeys(q.series)
            },
            "temperature": w.national_temperature,
        }
        return self._record(out)

    def rates(self, q: RateQuery) -> dict[str, Any]:
        w = self.world
        pairs = [(d, v) for d, v in zip(w.rate_dates, w.mortgage30, strict=False) if v is not None]
        if not pairs:
            raise ToolError("no mortgage rate data this run")
        pairs = pairs[-q.weeks :]
        values = [v for _, v in pairs]
        return self._record(
            {
                "series": "30-yr fixed mortgage rate, weekly (percent)",
                "dates": [d for d, _ in pairs],
                "mortgage30": values,
                "latest": values[-1],
                "first": values[0],
                "change_pp": round(values[-1] - values[0], 2),
                "high": max(values),
                "low": min(values),
            }
        )

    def episodes(self, q: EpisodeQuery) -> dict[str, Any]:
        m = self._metro(q.slug)
        yoy = _yoy_series(q.metric, m.series.get(q.metric, []))
        months = [d[:7] for d in m.dates]
        known = [(mo, v) for mo, v in zip(months, yoy, strict=False) if v is not None]
        if len(known) < 4:
            raise ToolError(f"not enough history for {q.metric} in {m.name}")
        current_month, current = known[-1]
        history = known[:-3]  # the months just before now are the same episode
        episodes: list[dict[str, Any]] = []
        run: list[tuple[str, float]] = []

        def close_run() -> None:
            if run:
                peak = max(run, key=lambda mv: abs(mv[1]))
                episodes.append(
                    {"start": run[0][0], "end": run[-1][0], "months": len(run), "peak_yoy": peak[1]}
                )
                run.clear()

        for mo, v in history:
            similar = current != 0 and (v > 0) == (current > 0) and abs(v) >= abs(current) / 2
            if similar:
                run.append((mo, v))
            else:
                close_run()
        close_run()
        closest = sorted(history, key=lambda mv: abs(mv[1] - current))[:3]
        return self._record(
            {
                "metro": m.name,
                "metric": q.metric,
                "change_unit": _change_key(q.metric),
                "current": {"month": current_month, "yoy": current},
                "months_searched": len(history),
                "similar_episodes": episodes,
                "closest_months": [{"month": mo, "yoy": v} for mo, v in closest],
            }
        )


def build_tools(box: Toolbox) -> list[Any]:
    @tool(timeout_seconds=10)
    def get_metro_series(args: SeriesQuery) -> dict:
        """Monthly history for up to 5 metrics of one metro (human units: percents as
        3.1, prices in USD), plus each metric's latest value and year-over-year change."""
        return box.metro_series(args)

    @tool(timeout_seconds=10)
    def compare_to_peers(args: PeerQuery) -> dict:
        """One metric for the metro and its 5 closest peers by homes sold (12 months) in
        the same Census region, with the peers' median year-over-year change."""
        return box.peers(args)

    @tool(timeout_seconds=10)
    def get_national_context(args: NationalQuery) -> dict:
        """U.S. national latest values and year-over-year changes for the given metrics."""
        return box.national(args)

    @tool(timeout_seconds=10)
    def get_rate_history(args: RateQuery) -> dict:
        """Weekly 30-year fixed mortgage rate for the last N weeks, with first/latest/high/low."""
        return box.rates(args)

    @tool(timeout_seconds=10)
    def find_similar_episodes(args: EpisodeQuery) -> dict:
        """Earlier stretches in the past 36 months when this metric's year-over-year change
        moved the same way as now (at least half as large), and the closest months."""
        return box.episodes(args)

    return [
        get_metro_series,
        compare_to_peers,
        get_national_context,
        get_rate_history,
        find_similar_episodes,
    ]


# ---- the loop ---------------------------------------------------------------------------

SYSTEM = """\
You investigate why one U.S. metro housing market is moving, for a public dashboard.
- Use the tools to look at the metro's own history, its peers in the same region, the national picture and (if relevant) mortgage rates. Look before you explain; don't call the same tool twice with the same input.
- Use only numbers the tools returned, written exactly as returned (you may round to fewer decimals). Never calculate new numbers: no differences, sums, ratios, multiples ("3 times", "twice"), averages or conversions.
- Percent changes are "%", changes in shares (fields named yoy_pp) are "pp", day changes are "days".
- Explain drivers the data supports (supply vs. demand, local vs. regional vs. national, rates). Say plainly when the data can't tell.
- Call a level high, low or minimal only when a tool result gives the comparison (peers, the nation, the metro's own history).
- Reason from the direction of each change: rising inventory, rising supply or falling sales loosen a market; falling inventory or rising sales tighten it.
- A peer comparison covers only the metro and its closest peers, never the whole region or the country.
- No predictions, no advice, no hype words.
- Finish with 4-6 sentences in `explanation` and the metric keys you relied on in `cited_metrics`."""

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"(])")
# Abbreviations whose period doesn't end a sentence ("St. Louis", "Ft. Myers", "U.S.").
_ABBREV = re.compile(r"\b(St|Ft|Mt|Jr|Sr|vs|U\.S)\.(?=\s)")



def _sentences(text: str) -> list[str]:
    protected = _ABBREV.sub(lambda m: m.group(1) + "\x00", text.strip())
    return [s.replace("\x00", ".") for s in _SENTENCE_END.split(protected) if s.strip()]


def first_sentence(text: str) -> str:
    return _sentences(text)[0] if text.strip() else ""


def count_sentences(text: str) -> int:
    return len(_sentences(text))


class InvestigationDraft(BaseModel):
    """The `finish` tool's input."""

    explanation: str = Field(
        description="4-6 sentences on why this is happening, using only numbers the tools returned"
    )
    cited_metrics: list[MetricKey] = Field(
        min_length=1, max_length=6, description="Metric keys the explanation relies on"
    )

    @field_validator("explanation")
    @classmethod
    def _four_to_six_sentences(cls, v: str) -> str:
        n = count_sentences(v)
        if not MIN_SENTENCES <= n <= MAX_SENTENCES:
            raise ValueError(f"explanation must be {MIN_SENTENCES}-{MAX_SENTENCES} sentences, got {n}")
        derived = find_derived(v, allow=GUARD_ALLOW_LOOP)
        if derived:
            # No tool returns a multiple, so "4.3 times" is arithmetic, even when 4.3
            # happens to match some other number the number guard knows. agents-core's
            # definition (v0.3.2), the same one the guard applies; rejecting it here
            # sends it back in-step instead of spending the guard's one retry.
            raise ValueError(
                f"don't compute multiples or ratios ({', '.join(map(repr, derived))}); state both figures instead"
            )
        return v.strip()


def task_facts(target: Target, world: World) -> dict[str, Any]:
    m = world.metros[target.slug]
    return {
        "metro": m.name,
        "slug": m.slug,
        "region": m.region,
        "data_through": world.data_through,
        "trigger": target.trigger,
        "trigger_label": target.trigger_label,
        "trigger_metric": target.trigger_metric,
        "flags": [f.label for f in m.flags],
    }


def task_prompt(target: Target, world: World) -> str:
    facts = task_facts(target, world)
    why = (
        f"has a new major flag this month: {target.trigger_label}"
        if target.trigger == "new_major_flag"
        else f"is this month's top mover: {target.trigger_label}"
    )
    return (
        f"{facts['metro']} (slug `{target.slug}`) {why}. Investigate why this is happening,"
        f" then call finish.\nTask facts JSON:\n{json.dumps(facts, sort_keys=True)}"
    )


def build_loop(
    llm: LLM,
    world: World,
    target: Target,
    *,
    budget: LoopBudget = BUDGET,
) -> tuple[AgentLoop[InvestigationDraft], Toolbox]:
    """Shared by the agent and the trajectory evals. Tools whose data is missing this
    run (no rate history) aren't offered (`allowed_tools`)."""
    box = Toolbox(world)
    tools = build_tools(box)
    allowed = [t.name for t in tools if t.name != "get_rate_history" or world.has_rates]
    facts = task_facts(target, world)

    def guard(draft: InvestigationDraft) -> GuardResult:
        # Rebuilt per call: the facts are everything the tools have returned so far.
        return fields_guard(guard_facts({"task": facts, "seen": box.seen}), ["explanation"], allow=GUARD_ALLOW_LOOP, no_multiples=True)(
            draft
        )

    loop = AgentLoop(
        llm,
        tools=tools,
        result_model=InvestigationDraft,
        system=SYSTEM,
        tier=TIER,
        budget=budget,
        allowed_tools=allowed,
        guard=guard,
        fallback=lambda: template_investigation(world, target),
        max_tokens=MAX_TOKENS,
        finish_description="Submit the explanation (4-6 sentences) and the metric keys it cites.",
        purpose=f"investigate:{target.slug}",
    )
    return loop, box


def run_investigation(
    llm: LLM, world: World, target: Target, *, budget: LoopBudget = BUDGET
) -> LoopResult[InvestigationDraft]:
    loop, box = build_loop(llm, world, target, budget=budget)
    result = loop.run(task_prompt(target, world))
    if result.ok and result.result is not None and result.narrative_source == "llm":
        # Keep only citations of metrics the model actually looked at.
        looked_at = _metrics_seen(box.seen)
        kept = [m for m in result.result.cited_metrics if m in looked_at] or [target.trigger_metric]
        result.result = result.result.model_copy(update={"cited_metrics": kept})
    return result


def _metrics_seen(seen: list[Any]) -> set[str]:
    keys: set[str] = set()
    for out in seen:
        keys |= set(out.get("series", {})) if isinstance(out.get("series"), dict) else set()
        if isinstance(out.get("metric"), str):
            keys.add(out["metric"])
    return keys


# ---- deterministic fallback -------------------------------------------------------------


def _fmt_change(key: str, change: float | None) -> str:
    if change is None:
        return "not available"
    kind = metric_registry.get(key)
    if kind.change_kind == "ratio":
        return f"{change:+.1f}%"
    if kind.change_kind == "pp":
        return f"{change:+.1f} pp"
    return f"{change:+.1f} {kind.unit or ''}".strip()


def template_investigation(world: World, target: Target) -> InvestigationDraft:
    """4-6 sentences built only from tool outputs (so it passes the same guard),
    used when there's no API key, the loop stops early, or the guard fails twice."""
    box = Toolbox(world)
    m = world.metros[target.slug]
    key = target.trigger_metric
    series = box.metro_series(
        SeriesQuery(slug=m.slug, metrics=["inventory", "homes_sold", "price_drops", "median_dom"])
    )["series"]
    peers = box.peers(PeerQuery(slug=m.slug, metric=key))
    change_key = _change_key(key)

    def latest(k: str) -> dict[str, Any]:
        return series.get(k, {}).get("latest", {}) if series.get(k, {}).get("unit") else {}

    lead = (
        f"{m.name} has a new major flag this month: {target.trigger_label}."
        if target.trigger == "new_major_flag"
        else f"{m.name} is this month's top mover: {target.trigger_label}."
    )
    sentences = [lead]
    inv, sold = latest("inventory"), latest("homes_sold")
    sentences.append(
        f"Active inventory changed {_fmt_change('inventory', inv.get('yoy_pct'))} year over year,"
        f" while homes sold changed {_fmt_change('homes_sold', sold.get('yoy_pct'))}."
    )
    peer_median = peers.get(f"peer_median_{change_key}")
    if peers["n_peers"] and m.region:
        sentences.append(
            f"Across its {peers['n_peers']} closest peers in the {m.region}, the median change in"
            f" {metric_registry.get(key).label.lower()} was {_fmt_change(key, peer_median)}."
        )
    drops, dom = latest("price_drops"), latest("median_dom")
    if drops.get("value") is not None and dom.get("value") is not None:
        sentences.append(
            f"Price drops hit {drops['value']}% of listings ({_fmt_change('price_drops', drops.get('yoy_pp'))}"
            f" YoY), and the median home spent {dom['value']} days on market."
        )
    if world.has_rates:
        rates = box.rates(RateQuery(weeks=52))
        sentences.append(
            f"The 30-year fixed mortgage rate was {rates['latest']}%, compared with {rates['first']}%"
            " a year earlier."
        )
    if len(sentences) < MIN_SENTENCES:
        sentences.append("These figures describe the change; they don't isolate a single cause.")
    cited = [key, "inventory", "homes_sold"] + (["price_drops"] if drops.get("value") is not None else [])
    return InvestigationDraft(explanation=" ".join(sentences[:MAX_SENTENCES]), cited_metrics=list(dict.fromkeys(cited)))


# ---- selection and publishing -----------------------------------------------------------


def select_targets(
    world: World,
    new_major: dict[str, list[WorldFlag]],
    price_yoy: dict[str, float | None],
    *,
    limit: int = MAX_TARGETS,
) -> list[Target]:
    """Metros with a new `major` flag (largest markets first), else the top mover."""
    trigger_metric = {"inventory_surge": "inventory", "price_decline": "median_sale_price"}
    flagged = sorted(
        (slug for slug, flags in new_major.items() if flags),
        key=lambda s: (-(world.metros[s].homes_sold_12m or 0), s),
    )
    if flagged:
        return [
            Target(
                slug=s,
                name=world.metros[s].name,
                trigger="new_major_flag",
                trigger_flag=new_major[s][0].id,
                trigger_label=new_major[s][0].label,
                trigger_metric=trigger_metric.get(new_major[s][0].id, "median_sale_price"),
            )
            for s in flagged[:limit]
        ]
    movers = [(s, v) for s, v in price_yoy.items() if v is not None and s in world.metros]
    if not movers:
        return []
    slug, yoy = max(movers, key=lambda sv: (abs(sv[1]), sv[0]))
    return [
        Target(
            slug=slug,
            name=world.metros[slug].name,
            trigger="top_mover",
            trigger_label=f"Median price {yoy:+.1%} YoY",
            trigger_metric="median_sale_price",
        )
    ]


def investigation_record(
    target: Target,
    result: LoopResult[InvestigationDraft] | None,
    draft: InvestigationDraft,
    narrative_source: str,
) -> dict[str, Any]:
    """The published `Investigation` (schema.py) as a dict."""
    llm_used = result is not None and narrative_source == "llm"
    return {
        "slug": target.slug,
        "name": target.name,
        "trigger": target.trigger,
        "trigger_flag": target.trigger_flag,
        "trigger_label": target.trigger_label,
        "explanation": draft.explanation,
        "cited_metrics": list(draft.cited_metrics),
        "narrative_source": narrative_source,
        "model": tier_config(TIER).model if llm_used else None,
        "stop_reason": result.stop_reason if result is not None else "not_run",
        "steps": result.steps if result is not None else 0,
        "tools_called": result.tools_called() if result is not None else [],
        "cost_usd": round(result.usd, 6) if result is not None else 0.0,
        "prompt_version": PROMPT_VERSION,
        "generated_at": datetime.now(UTC),
        "reused": False,
    }

