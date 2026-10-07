"""The report agent (Listing Prep P5, SPEC_LISTING_PREP.md §6, §7).

An `agents_core.agent_loop.AgentLoop` (smart tier, a per-report budget) researches one
property with read-only tools over numbers this package computed, then writes the
narrative of the report's nine sections. Code computes and assembles every figure in the
report (`assemble`); the model only narrates them.

    get_property                facts, goal (target price, budget, days to list), missing facts
    get_market_context          ZIP and city medians and changes (Redfin, the region data)
    find_comparables            MLS closed sales: not licensed yet (P7), says so
    get_competing_listings      MLS active listings: not licensed yet (P7), says so
    get_buyer_demand            needs-based segments with weights and their evidence (§5.3)
    get_schools / get_amenities nearest public schools (no ratings) and walkable amenities
    get_findings                the agent-confirmed condition findings, by room, and rooms not photographed
    estimate_items              every candidate improvement: cost, value, net, ROI, confidence (§5.4)
    optimize_budget             the scenarios and the marginal table (§5.5)
    evidence_gaps               research still to do this run, and data gaps it can't close
    finish(report)              the narrative

The model stops when `evidence_gaps` says no research is left (or the budget is spent).
`finish` is checked three ways before it's accepted:

1. **Structure** (pydantic, the `finish` schema): every section present and short, item
   notes only for items `estimate_items` returned, no computed multiples, no promises
   about the sale price, and the fair-housing rule screen (`fair_housing`, report scope).
   A failure goes back to the model as a tool error.
2. **Fair-housing review**: a second, fast-tier model reads the narrative for anything the
   rules can't see (implied preferences, steering by description). Its issues go back the
   same way. If the reviewer can't answer, the narrative is not published: the template is.
3. **Number guard** (`agents_core.guards`): every figure must be one a tool returned in
   this run. One retry, then the template (`template_draft`: plain wording, every number
   from the tools).

A loop that stops early (budget, refusal, no `finish`) also publishes the template, with
a warning. `ReportWorld` is a plain JSON snapshot, so the evals run the same loop on
fixture properties. Bump PROMPT_VERSION whenever the prompt, the tools or the checks change.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from typing import Any, Literal

from agents_core.agent_loop import AgentLoop, LoopBudget, LoopResult, tool
from agents_core.costs import BudgetExceeded, SpendScope
from agents_core.guards import GuardResult, extract_numbers, fields_guard
from agents_core.llm import LLM, LLMError, tier_config
from pydantic import BaseModel, Field, create_model, field_validator, model_validator

from agents.listing_prep import fair_housing, optimizer
from agents.listing_prep.improvements import Estimate, Price, Prior, estimate_items
from agents.listing_prep.insights import area_for
from agents.real_estate import metrics as metric_registry

PROMPT_VERSION = "p5-report-1"
TIER = "smart"
REVIEW_TIER = "fast"
MAX_TOKENS = 4000
REVIEW_MAX_TOKENS = 800
# A report is minutes of latency and cents of spend: ~10 smart-tier calls over a growing
# conversation (~15K tokens each by the end) plus a few fast-tier reviews.
BUDGET = LoopBudget(max_steps=14, max_usd=0.75, max_seconds=420)
REVIEW_BUDGET_USD = 0.05
# The "expected outcome" section uses the seller's budget, or this standard scenario.
OUTCOME_BUDGET = 10_000
MAX_WORDS = 130  # per narrative section
EXPECTED_ROOMS = ("exterior_front", "kitchen", "living", "primary_bedroom", "primary_bath")
KEY_FACTS = ("beds", "baths", "sqft", "year_built", "property_type")
# Phrases with numbers that aren't figures: the condition scale, "a 20-minute walk".
GUARD_ALLOW = ("1 to 5", "1-5", "out of 5", "20-minute walk", "20-minute")
DISCLAIMER = (
    "This is a market analysis for pricing and preparation strategy. It is not an appraisal and not"
    " a guarantee of sale price. Value and cost figures are estimates with the ranges and confidence shown."
)
RESEARCH_TOOLS = (
    "get_property",
    "get_market_context",
    "find_comparables",
    "get_competing_listings",
    "get_buyer_demand",
    "get_schools",
    "get_amenities",
    "get_findings",
    "estimate_items",
    "optimize_budget",
)
ROOM_LABELS = {
    "exterior_front": "front exterior", "exterior_back": "back exterior", "living": "living room",
    "family": "family room", "dining": "dining room", "primary_bedroom": "primary bedroom",
    "primary_bath": "primary bath", "half_bath": "half bath", "office": "office", "laundry": "laundry room",
}
NO_MLS = "MLS data isn't licensed yet (Listing Prep P7), so there are no comparable sales or competing listings in this run."
PRIVACY_NOTE = "Needs size the demand for features the home can offer. They guide preparation, never who to market to."


# ---- the snapshot the tools read ---------------------------------------------------------


class Goal(BaseModel):
    target_price: int | None = None
    budget: int | None = None  # the seller's preparation budget
    days_to_list: int | None = None


class ReportWorld(BaseModel):
    """Everything the tools read, as plain JSON. The worker builds it from the Desk's
    database and the published region data; the evals load fixtures. No address, no
    names: the model gets the ZIP and city, the confirmed facts and the findings."""

    zip: str | None = None
    city: str | None = None
    facts: dict[str, Any] = Field(default_factory=dict)
    goal: Goal = Field(default_factory=Goal)
    data_through: str | None = None
    zip_market: dict[str, dict[str, float | None]] | None = None  # the region data's `latest`
    zip_low_sample: bool = False
    city_market: dict[str, dict[str, float | None]] | None = None
    valuation: dict[str, Any] | None = None  # property_insights.valuation
    segments: list[dict[str, Any]] | None = None
    schools: list[dict[str, Any]] | None = None
    amenities: list[dict[str, Any]] | None = None
    insight_notes: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    findings: list[dict[str, Any]] = Field(default_factory=list)  # confirmed or edited only
    rooms_photographed: list[str] = Field(default_factory=list)
    cost_book: dict[str, dict[str, Any]] = Field(default_factory=dict)  # item -> {unit, low, high}
    quotes: list[dict[str, Any]] = Field(default_factory=list)  # {item, low_usd, high_usd}
    priors: dict[str, dict[str, Any]] = Field(default_factory=dict)  # item -> {recovery_low, recovery_high, source}


def _num(v: Any) -> float | None:
    return None if v is None else float(v)


def build_world(inputs: dict[str, Any], region: dict[str, Any] | None, goal: Goal) -> ReportWorld:
    """The snapshot from the worker's reads (`Backend.report_inputs`) and the published
    region data. Pure, so it's tested without a backend."""
    prop = inputs["property"]
    ins = inputs.get("insights") or {}
    z, c = area_for(region, prop.get("zip"), prop.get("place_id"))
    return ReportWorld(
        zip=prop.get("zip"),
        city=prop.get("city") or (c or {}).get("name"),
        facts=prop.get("facts") or {},
        goal=goal,
        data_through=(region or {}).get("data_through"),
        zip_market=(z or {}).get("latest"),
        zip_low_sample=bool((z or {}).get("low_sample")),
        city_market=(c or {}).get("latest"),
        valuation=ins.get("valuation"),
        segments=ins.get("segments"),
        schools=ins.get("schools"),
        amenities=ins.get("amenities"),
        insight_notes=list(ins.get("notes") or []),
        sources=list(ins.get("sources") or []),
        findings=list(inputs.get("findings") or []),
        rooms_photographed=list(inputs.get("rooms_photographed") or []),
        cost_book={r["item"]: {"unit": r["unit"], "low": _num(r.get("low_usd")), "high": _num(r.get("high_usd"))} for r in inputs.get("cost_book") or []},
        quotes=[{"item": q["item"], "low_usd": float(q["low_usd"]), "high_usd": float(q["high_usd"])} for q in inputs.get("quotes") or []],
        priors={r["item"]: {"recovery_low": float(r["recovery_low"]), "recovery_high": float(r["recovery_high"]), "source": r["source"]} for r in inputs.get("priors") or []},
    )


# ---- units ----------------------------------------------------------------------------------


def _money(v: float | None) -> int | None:
    return None if v is None else int(round(v))


def _kind(key: str) -> tuple[str, str]:
    """(format, change kind) of a region metric."""
    if key == "median_ppsf":
        return "currency", "ratio"
    m = metric_registry.get(key)
    return m.format, m.change_kind


def _human_metric(key: str, entry: dict[str, float | None]) -> dict[str, Any] | None:
    try:
        fmt, change = _kind(key)
    except KeyError:
        return None
    v, y = entry.get("value"), entry.get("yoy")
    if fmt == "percent":
        value: float | int | None = None if v is None else round(v * 100, 1)
    elif fmt in ("currency", "count", "days"):
        value = None if v is None else int(round(v))
    else:
        value = None if v is None else round(v, 1)
    out: dict[str, Any] = {"label": "Median sale price per sq ft" if key == "median_ppsf" else metric_registry.get(key).label, "value": value}
    if change == "ratio":
        out["yoy_pct"] = None if y is None else round(y * 100, 1)
    elif change == "pp":
        out["yoy_pp"] = None if y is None else round(y * 100, 1)
    else:
        out["yoy_change"] = None if y is None else round(y, 1)
    if fmt == "percent":
        out["unit"] = "percent"
    elif fmt == "currency":
        out["unit"] = "USD"
    elif key == "median_dom":
        out["unit"] = "days"
    elif key == "months_of_supply":
        out["unit"] = "months"
    return out


def _market(latest: dict[str, dict[str, float | None]] | None) -> dict[str, Any] | None:
    if not latest:
        return None
    out = {k: h for k, e in latest.items() if isinstance(e, dict) and (h := _human_metric(k, e)) is not None}
    return out or None


def room_label(room: Any) -> str:
    """"family" alone would read as people; rooms are always named as rooms."""
    r = str(room or "other")
    return ROOM_LABELS.get(r, r.replace("_", " "))


def _some(labels: list[str], n: int = 6) -> str:
    return ", ".join(labels) if len(labels) <= n else ", ".join(labels[:n]) + f" and {len(labels) - n} more"


# ---- tools ------------------------------------------------------------------------------------


class NoArgs(BaseModel):
    pass


class CompQuery(BaseModel):
    radius_miles: float = Field(default=1.0, ge=0.25, le=3.0)
    months: int = Field(default=12, ge=3, le=24)


class ListingQuery(BaseModel):
    price_low: int | None = Field(default=None, ge=0)
    price_high: int | None = Field(default=None, ge=0)


class FindingQuery(BaseModel):
    room: str | None = Field(default=None, description="Only this room (e.g. 'kitchen'); omit for all")


class BudgetQuery(BaseModel):
    budgets: list[int] = Field(
        default_factory=list,
        max_length=3,
        description="Extra budgets in dollars to add to the standard scenarios ($5K, $10K, $25K, $50K and the seller's)",
    )


def _estimate_dict(e: Estimate) -> dict[str, Any]:
    return {
        "key": e.key,
        "label": e.label,
        "status": e.status,
        "reason": e.reason,
        "quantity": e.quantity,
        "unit": e.unit,
        "cost_low": _money(e.cost_low),
        "cost_high": _money(e.cost_high),
        "cost_source": e.cost_source,
        "value_low": _money(e.value_low),
        "value_high": _money(e.value_high),
        "risk_adjusted_value": _money(e.risk_value),
        "risk_adjusted_net": _money(e.risk_net),
        "roi_pct": None if e.roi is None else round(e.roi * 100, 1),
        "confidence": e.confidence,
        "days": e.days,
        "group": e.group,
        "requires": e.requires,
        "evidence": e.evidence,
        "prior_source": e.prior_source,
    }


class Toolbox:
    """The report agent's tools over one `ReportWorld`. Every output is appended to
    `seen`, which the number guard checks the narrative against; `called` is what
    `evidence_gaps` reports as research done."""

    def __init__(self, world: ReportWorld) -> None:
        self.world = world
        self.seen: list[Any] = []
        self.called: set[str] = set()
        self._estimates: list[Estimate] | None = None

    def _record(self, name: str, out: dict[str, Any]) -> dict[str, Any]:
        self.called.add(name)
        self.seen.append(out)
        return out

    # -- computations (shared with `assemble`, so the report and the tools agree) --

    def estimates(self) -> list[Estimate]:
        if self._estimates is None:
            w = self.world
            self._estimates = estimate_items(
                findings=w.findings,
                facts=w.facts,
                cost_book={k: Price(str(v.get("unit")), v.get("low"), v.get("high")) for k, v in w.cost_book.items()},
                quotes=w.quotes,
                priors={k: Prior(float(v["recovery_low"]), float(v["recovery_high"]), str(v["source"])) for k, v in w.priors.items()},
                segments=w.segments or [],
                days_to_list=w.goal.days_to_list,
            )
        return self._estimates

    def value_range(self) -> tuple[int, int] | None:
        v = self.world.valuation
        return (int(v["low"]), int(v["high"])) if v and v.get("low") is not None and v.get("high") is not None else None

    def scenarios(self, extra: Iterable[int] = ()) -> optimizer.Outcome:
        est = self.estimates()
        seller = self.world.goal.budget
        out = optimizer.scenarios(est, seller, self.value_range())
        extra = [b for b in extra if b > 0 and b not in {p.budget for p in out.scenarios}]
        if extra:
            plans = sorted([*out.scenarios, *(optimizer.optimize(est, b, self.value_range()) for b in extra)], key=lambda p: p.budget)
            out = optimizer.Outcome(plans, out.marginal, out.avoid, out.not_estimated)
        return out

    def label(self, key: str) -> str:
        return next((e.label for e in self.estimates() if e.key == key), key.replace("_", " "))

    def plan_dict(self, p: optimizer.Plan) -> dict[str, Any]:
        return {
            "budget": _money(p.budget),
            "is_seller_budget": self.world.goal.budget is not None and p.budget == self.world.goal.budget,
            "items": [self.label(k) for k in p.items],
            "item_keys": list(p.items),
            "cost_low": _money(p.cost_low),
            "cost_high": _money(p.cost_high),
            "value_added_low": _money(p.value_low),
            "value_added_high": _money(p.value_high),
            "risk_adjusted_net": _money(p.risk_net),
            "unspent": _money(p.unspent),
            # to the nearest $1,000: the range it's added to is rounded to $5,000
            "value_after_low": _money(round(p.value_after[0], -3)) if p.value_after else None,
            "value_after_high": _money(round(p.value_after[1], -3)) if p.value_after else None,
        }

    def data_gaps(self) -> list[dict[str, str]]:
        """What this run can't know, why it matters, and what would fix it."""
        w = self.world
        gaps: list[dict[str, str]] = []
        if not w.valuation:
            gaps.append({"gap": "No value range", "effect": "The snapshot and expected outcome have no current or after-work range.", "fix": "; ".join(w.insight_notes) or "Confirm the living area; the worker computes the range."})
        elif w.valuation.get("interval") == "rough":
            gaps.append({"gap": "The value range is rough", "effect": "It comes from ZIP medians, not comparable sales, so it is wide and Low confidence.", "fix": "Comparable sales from the MLS feed (P7) narrow it."})
        gaps.append({"gap": "No comparable sales or competing listings", "effect": "Item values rest on the team's priors, never on local sales evidence, so every item is Low confidence.", "fix": "They come with the MLS feed (P7)."})
        if w.segments is None:
            gaps.append({"gap": "Buyer demand isn't sized", "effect": "Item values aren't weighted by buyer needs.", "fix": "Set the Census key (CENSUS_API_KEY) for the worker."})
        missing_rooms = [r for r in EXPECTED_ROOMS if r not in w.rooms_photographed]
        if missing_rooms:
            gaps.append({"gap": "Rooms without photos: " + _some([room_label(r) for r in missing_rooms]), "effect": "Their condition isn't known, so no improvements are suggested for them.", "fix": "Upload photos of those rooms and review the findings."})
        missing_facts = [k for k in KEY_FACTS if w.facts.get(k) in (None, "")]
        if missing_facts:
            gaps.append({"gap": "Facts not confirmed: " + ", ".join(k.replace("_", " ") for k in missing_facts), "effect": "Quantities and buyer fit may be off.", "fix": "Confirm them on the Desk."})
        by_status: dict[str, list[str]] = {}
        for e in self.estimates():
            by_status.setdefault(e.status, []).append(e.label)
        texts = {
            "no_prior": ("No value prior", "Their value can't be estimated: not enough evidence.", "Add the team's value priors for them (with a source)."),
            "no_price": ("No price", "Their cost can't be estimated.", "Add them to the cost book or get a quote."),
            "no_quantity": ("No quantity", "Their cost can't be sized.", "Add the quantity on the finding."),
            "too_slow": ("Can't finish before listing", "They're left out of every plan.", "Choose a later listing date if the seller wants them."),
        }
        for status, (what, effect, fix) in texts.items():
            if by_status.get(status):
                gaps.append({"gap": f"{what}: " + _some(by_status[status]), "effect": effect, "fix": fix})
        if w.zip_low_sample:
            gaps.append({"gap": "Few sales in this ZIP", "effect": "Its medians move a lot month to month.", "fix": "Read the city figures alongside."})
        return gaps

    # -- the tools --

    def get_property(self) -> dict[str, Any]:
        w = self.world
        return self._record("get_property", {
            "zip": w.zip,
            "city": w.city,
            "facts": w.facts,
            "goal": w.goal.model_dump(),
            "missing_facts": [k for k in KEY_FACTS if w.facts.get(k) in (None, "")],
        })

    def get_market_context(self) -> dict[str, Any]:
        w = self.world
        return self._record("get_market_context", {
            "data_through": w.data_through,
            "source": "Redfin ZIP and city medians (the Desk's published region data)",
            "zip": w.zip,
            "zip_market": _market(w.zip_market),
            "zip_low_sample": w.zip_low_sample,
            "city": w.city,
            "city_market": _market(w.city_market),
            "valuation": w.valuation,
        })

    def find_comparables(self, q: CompQuery) -> dict[str, Any]:
        return self._record("find_comparables", {"available": False, "radius_miles": q.radius_miles, "months": q.months, "reason": NO_MLS})

    def get_competing_listings(self, q: ListingQuery) -> dict[str, Any]:
        return self._record("get_competing_listings", {"available": False, "reason": NO_MLS})

    def get_buyer_demand(self) -> dict[str, Any]:
        segs = self.world.segments
        if segs is None:
            note = next((n for n in self.world.insight_notes if "demand" in n.lower()), "Buyer demand couldn't be sized.")
            return self._record("get_buyer_demand", {"available": False, "reason": note})
        return self._record("get_buyer_demand", {
            "available": True,
            "note": PRIVACY_NOTE,
            "segments": [
                {
                    "key": s.get("key"),
                    "label": s.get("label"),
                    "share_of_demand_pct": round(float(s.get("weight", 0)) * 100),
                    "priorities": s.get("priorities", []),
                    "evidence": s.get("evidence", []),
                    "reliable": s.get("reliable", True),
                    "reliability_note": s.get("reliability"),
                }
                for s in segs
            ],
        })

    def get_schools(self) -> dict[str, Any]:
        s = self.world.schools
        if s is None:
            return self._record("get_schools", {"available": False, "reason": "No school list for this property (no map pin, or the directory was unavailable)."})
        return self._record("get_schools", {
            "available": True,
            "note": "Nearest public schools by distance, not attendance boundaries. The Desk doesn't rate schools.",
            "schools": [{"name": x.get("name"), "level": x.get("level"), "grades": x.get("grades"), "charter": x.get("charter"), "miles": x.get("miles")} for x in s],
        })

    def get_amenities(self) -> dict[str, Any]:
        a = self.world.amenities
        if a is None:
            return self._record("get_amenities", {"available": False, "reason": "No amenities for this property yet."})
        return self._record("get_amenities", {"available": True, "radius": "about a 20-minute walk", "amenities": a})

    def get_findings(self, q: FindingQuery) -> dict[str, Any]:
        w = self.world
        fs = [f for f in w.findings if q.room is None or f.get("room") == q.room or room_label(f.get("room")) == q.room]
        by_room: dict[str, dict[str, Any]] = {}
        for f in w.findings:
            r = by_room.setdefault(room_label(f.get("room")), {"findings": 0, "conditions": []})
            r["findings"] += 1
            r["conditions"].append(int(f.get("condition", 3)))
        summary = {room: {"findings": v["findings"], "average_condition": round(sum(v["conditions"]) / len(v["conditions"]), 1), "lowest_condition": min(v["conditions"])} for room, v in by_room.items()}
        keys = ("room", "category", "condition", "issue", "suggested_fix", "fix_item", "quantity", "severity")
        return self._record("get_findings", {
            "condition_scale": "1 = needs replacing, 3 = average wear, 5 = like new",
            "findings": [{k: (room_label(f.get(k)) if k == "room" else f.get(k)) for k in keys} for f in fs],
            "by_room": summary,
            "rooms_photographed": [room_label(r) for r in w.rooms_photographed],
            "rooms_not_photographed": [room_label(r) for r in EXPECTED_ROOMS if r not in w.rooms_photographed],
        })

    def estimate_items_tool(self) -> dict[str, Any]:
        est = self.estimates()
        counts: dict[str, int] = {}
        for e in est:
            counts[e.status] = counts.get(e.status, 0) + 1
        return self._record("estimate_items", {
            "how": "Cost: a quote, else the team's cost book × quantity. Value: the team's value prior (share of cost recovered at resale) × buyer relevance. Low confidence = the conservative end (risk-adjusted). Net = risk-adjusted value − the expected cost. ROI = net ÷ expected cost.",
            "status_counts": counts,
            "items": [_estimate_dict(e) for e in est],
        })

    def optimize_budget(self, q: BudgetQuery) -> dict[str, Any]:
        out = self.scenarios(q.budgets)
        return self._record("optimize_budget", {
            "how": "The best set of candidate items for each budget, maximizing risk-adjusted net gain; at most one option per group, prerequisites paid once, planned against the high cost.",
            "value_range_now": list(self.value_range()) if self.value_range() else None,
            "scenarios": [self.plan_dict(p) for p in out.scenarios],
            "marginal": [{"budget": _money(r["budget"]), "adds": [self.label(k) for k in r["adds"]], "drops": [self.label(k) for k in r["drops"]], "added_net_gain": _money(r["gain"])} for r in out.marginal],
            "avoid": [{"label": e.label, "reason": e.reason} for e in out.avoid],
        })

    def evidence_gaps(self) -> dict[str, Any]:
        left = [t for t in RESEARCH_TOOLS if t not in self.called]
        return self._record("evidence_gaps", {
            "research_remaining": left,
            "done": not left,
            "data_gaps": self.data_gaps(),
            "note": "Data gaps can't be closed in this run: state them plainly in the report's `gaps`.",
        })


def build_tools(box: Toolbox) -> list[Any]:
    @tool(timeout_seconds=10)
    def get_property(args: NoArgs) -> dict:
        """The property's confirmed facts (ZIP, city, beds, baths, sq ft…), the seller's goal (target price, preparation budget, days until listing) and which key facts are missing."""
        return box.get_property()

    @tool(timeout_seconds=10)
    def get_market_context(args: NoArgs) -> dict:
        """The ZIP's and city's latest market medians with year-over-year changes (human units), the data date, and the property's value range (method, confidence, interval kind)."""
        return box.get_market_context()

    @tool(timeout_seconds=10)
    def find_comparables(args: CompQuery) -> dict:
        """Comparable closed sales near the property (MLS). Says whether they're available in this run."""
        return box.find_comparables(args)

    @tool(timeout_seconds=10)
    def get_competing_listings(args: ListingQuery) -> dict:
        """Active and pending listings competing in the price band (MLS). Says whether they're available in this run."""
        return box.get_competing_listings(args)

    @tool(timeout_seconds=10)
    def get_buyer_demand(args: NoArgs) -> dict:
        """Buyer needs this home can meet (needs-based segments), each with its share of estimated demand, its priorities and the Census evidence behind it."""
        return box.get_buyer_demand()

    @tool(timeout_seconds=10)
    def get_schools(args: NoArgs) -> dict:
        """The nearest public schools by distance (names, levels, miles). Not attendance areas, no ratings."""
        return box.get_schools()

    @tool(timeout_seconds=10)
    def get_amenities(args: NoArgs) -> dict:
        """Counts of everyday amenities within about a 20-minute walk (groceries, parks, transit, cafés…) and the nearest of each."""
        return box.get_amenities()

    @tool(timeout_seconds=10)
    def get_findings(args: FindingQuery) -> dict:
        """The condition findings the agent confirmed from the photos (room, category, condition 1-5, issue, fix), a summary by room, and the key rooms with no photos."""
        return box.get_findings(args)

    @tool(name="estimate_items", timeout_seconds=10)
    def estimate_items_(args: NoArgs) -> dict:
        """Every candidate improvement with its cost range, value range, risk-adjusted net gain, ROI, confidence, days to complete and status (candidate, avoid, or why it can't be estimated)."""
        return box.estimate_items_tool()

    @tool(timeout_seconds=20)
    def optimize_budget(args: BudgetQuery) -> dict:
        """The best plan for each budget ($5K, $10K, $25K, $50K, the seller's, and any extra you ask for), what each next $5K buys, and the items to avoid."""
        return box.optimize_budget(args)

    @tool(timeout_seconds=10)
    def evidence_gaps(args: NoArgs) -> dict:
        """Which research tools you haven't used yet in this run, and the data gaps the report must state."""
        return box.evidence_gaps()

    return [get_property, get_market_context, find_comparables, get_competing_listings, get_buyer_demand, get_schools, get_amenities, get_findings, estimate_items_, optimize_budget, evidence_gaps]


# ---- the draft (`finish`) and its checks ----------------------------------------------------------

_MULTIPLE = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:x|×|times)(?!\w)|\b(?:twice|double|triple|(?:two|three|four|five|ten)\s+times)\b",
    re.IGNORECASE,
)
_PROMISE = re.compile(
    r"\bguarantee[sd]?\b|\bwill (?:sell|net|add|increase|raise|bring|fetch|recoup|return)\b|\bcertain(?:ly)? to\b|\bensures?\b",
    re.IGNORECASE,
)


def _words_ok(v: str, max_words: int = MAX_WORDS) -> str:
    v = v.strip()
    n = len(v.split())
    if n > max_words:
        raise ValueError(f"at most {max_words} words, got {n}")
    return v


class ItemNote(BaseModel):
    key: str = Field(description="An item key from estimate_items")
    reasoning: str = Field(min_length=10, max_length=500, description="1-2 sentences: why, from the item's evidence and figures")


class Strategy(BaseModel):
    staging: str = Field(min_length=20, description="2-4 sentences on staging and preparation")
    shot_list: list[str] = Field(min_length=3, max_length=12, description="Photos to take, one short line each")
    positioning: str = Field(min_length=20, description="2-3 sentences: which features to lead with, from the buyer needs")
    description_angles: list[str] = Field(min_length=2, max_length=5, description="Angles for the listing description, about the property's features")

    @field_validator("staging", "positioning")
    @classmethod
    def _short(cls, v: str) -> str:
        return _words_ok(v)

    @field_validator("shot_list", "description_angles")
    @classmethod
    def _lines(cls, v: list[str]) -> list[str]:
        return [_words_ok(x, 30) for x in v]


SECTION_HELP = {
    "snapshot": "2-4 sentences: the value range with its method and confidence, the target price, and the home's strengths and weaknesses from the findings",
    "buyers": "2-4 sentences: the buyer needs this home can meet, with their shares, and the features that matter to them",
    "market": "2-4 sentences: the ZIP and city market, and what comparable-sales and competition evidence is (or isn't) available",
    "budget": "2-4 sentences: what the scenarios buy and where extra money stops paying",
    "highest_roi": "1-3 sentences: the candidate items with the best risk-adjusted return",
    "avoid": "1-3 sentences: the items to avoid and why (or that none were found)",
    "outcome": "2-3 sentences: for the seller's budget (or the $10K plan), the investment, the range after the work and the net benefit",
}


class ReportDraft(BaseModel):
    """The `finish` tool's input: the report's narrative. Every table and figure around it is assembled by code."""

    snapshot: str = Field(description=SECTION_HELP["snapshot"])
    buyers: str = Field(description=SECTION_HELP["buyers"])
    market: str = Field(description=SECTION_HELP["market"])
    improvements: list[ItemNote] = Field(default_factory=list, max_length=25, description="A note for each item worth discussing (candidates and items to avoid)")
    budget: str = Field(description=SECTION_HELP["budget"])
    highest_roi: str = Field(description=SECTION_HELP["highest_roi"])
    avoid: str = Field(description=SECTION_HELP["avoid"])
    strategy: Strategy
    outcome: str = Field(description=SECTION_HELP["outcome"])
    gaps: list[str] = Field(default_factory=list, max_length=8, description="The evidence gaps, one plain sentence each")

    @field_validator("snapshot", "buyers", "market", "budget", "highest_roi", "avoid", "outcome")
    @classmethod
    def _section(cls, v: str) -> str:
        if len(v.strip()) < 20:
            raise ValueError("write at least one full sentence")
        return _words_ok(v)

    @field_validator("gaps")
    @classmethod
    def _gaps(cls, v: list[str]) -> list[str]:
        return [_words_ok(x, 40) for x in v]

    @model_validator(mode="after")
    def _rules(self) -> ReportDraft:
        texts = narrative_texts(self)
        problems: list[str] = []
        for t in texts:
            m = _MULTIPLE.search(t)
            if m:
                problems.append(f"don't compute multiples ({m.group(0)!r}); state both figures instead")
            p = _PROMISE.search(t)
            if p:
                problems.append(f"no promises about the outcome ({p.group(0)!r}); these are estimates, say 'estimated' or give the range")
        for topic, words in fair_housing.explain(texts, scope="report"):
            problems.append(
                f"fair housing ({topic}): remove {words!r}. Describe the property's features and buyer needs for features, never people, who would buy or live there, or the neighborhood's character"
            )
        if problems:
            raise ValueError("; ".join(dict.fromkeys(problems)))
        return self


NARRATIVE_FIELDS = (
    "snapshot",
    "buyers",
    "market",
    "improvements.reasoning",
    "budget",
    "highest_roi",
    "avoid",
    "strategy.staging",
    "strategy.shot_list",
    "strategy.positioning",
    "strategy.description_angles",
    "outcome",
    "gaps",
)


def narrative_texts(d: Any) -> list[str]:
    s = d.strategy
    return [
        d.snapshot, d.buyers, d.market, *(n.reasoning for n in d.improvements), d.budget, d.highest_roi, d.avoid,
        s.staging, *s.shot_list, s.positioning, *s.description_angles, d.outcome, *d.gaps,
    ]


def _guard_facts(facts: Any) -> dict[str, Any]:
    """Every number the guard accepts: the facts' numbers plus numbers inside their strings
    (finding issues, evidence lines and prior sources are data the tools returned)."""
    embedded: list[float] = []

    def walk(x: Any) -> None:
        if isinstance(x, str):
            embedded.extend(t.value * t.scale for t in extract_numbers(x))
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list | tuple):
            for v in x:
                walk(v)

    walk(facts)
    return {"facts": facts, "string_numbers": embedded}


def number_guard(box: Toolbox) -> Callable[[Any], GuardResult]:
    def guard(draft: Any) -> GuardResult:
        # Rebuilt per call: the facts are everything the tools have returned so far.
        return fields_guard(_guard_facts({"seen": box.seen}), list(NARRATIVE_FIELDS), allow=GUARD_ALLOW)(draft)

    return guard


# ---- the fair-housing reviewer --------------------------------------------------------------


class ReviewIssue(BaseModel):
    quote: str = Field(max_length=300)
    reason: str = Field(max_length=300)


class Review(BaseModel):
    compliant: bool
    issues: list[ReviewIssue] = Field(default_factory=list, max_length=10)


REVIEW_TOOL = {
    "name": "record_review",
    "description": "Record the fair-housing review. Call it exactly once.",
    "input_schema": Review.model_json_schema(),
}

REVIEW_SYSTEM = """You review the narrative of a home-sale preparation report for U.S. fair-housing compliance (the federal Fair Housing Act and California's FEHA).

Flag text that:
- states or implies a preference, limitation or exclusion based on race, color, religion, sex, gender identity or expression, sexual orientation, familial status (children, pregnancy), disability, national origin, ancestry, age, marital status, source of income, citizenship, primary language, immigration status, genetic information or military/veteran status;
- describes who should, would or will buy or live in the home (steering), instead of the home's features;
- describes the people, safety, crime or "character" of the neighborhood, or rates schools or claims an attendance area.

Not a problem: describing the property's features and condition; distances to schools, parks, transit and shops; buyer NEEDS for features (more bedrooms, a home office, single-level living, low maintenance, outdoor space); prices, costs and market figures.

Quote each problem exactly. Call record_review once; compliant = true only when there are no issues."""


class Reviewer:
    """One fast-tier call per draft. `last_ok` is True only when the reviewer answered
    and found nothing; None when it couldn't answer (the draft is then not published)."""

    def __init__(self, llm: LLM, budget_usd: float = REVIEW_BUDGET_USD) -> None:
        self.llm = llm
        self.budget_usd = budget_usd
        self.usd = 0.0
        self.calls = 0
        self.last_ok: bool | None = None
        self.recorded: list[dict[str, Any]] = []  # each response, for replayable eval recordings

    def __call__(self, draft: Any) -> list[ReviewIssue] | None:
        text = "\n".join(f"- {t}" for t in narrative_texts(draft))
        messages = [{"role": "user", "content": f"Report narrative to review:\n{text}"}]
        self.last_ok = None
        for _ in range(2):
            # A scope counts everything the tracker spends while it's open (the loop's calls
            # too), so each review call gets its own, sized to what's left of the review budget.
            scope = SpendScope(self.llm.tracker, max(self.budget_usd - self.usd, 0.0), label="listing_prep.report_review")
            try:
                turn = self.llm.converse(REVIEW_TIER, messages, system=REVIEW_SYSTEM, tools=[REVIEW_TOOL], max_tokens=REVIEW_MAX_TOKENS, purpose="listing_prep.report_review", temperature=0, budget=scope)
            except (BudgetExceeded, LLMError):
                return None
            self.calls += 1
            self.usd += turn.usd
            self.recorded.append({"content": turn.content, "stop_reason": turn.stop_reason, "usage": {"input_tokens": turn.usage.input_tokens, "output_tokens": turn.usage.output_tokens}})
            if turn.stop_reason == "refusal":
                return None
            for use in turn.tool_uses:
                if use.get("name") == REVIEW_TOOL["name"]:
                    try:
                        review = Review.model_validate(use.get("input") or {})
                    except ValueError:
                        break
                    issues = review.issues if (review.issues or not review.compliant) else []
                    if not review.compliant and not issues:
                        issues = [ReviewIssue(quote="", reason="The reviewer marked the narrative non-compliant without quoting it.")]
                    self.last_ok = not issues
                    return issues
        return None


def finish_model(keys: list[str], reviewer: Reviewer | None) -> type[ReportDraft]:
    """The `finish` schema for this property: item notes may only name items
    `estimate_items` returned, and (with a reviewer) the fair-housing review runs on
    every draft that passes the rules."""
    key_type: Any = Literal[tuple(keys)] if keys else str  # type: ignore[valid-type]
    note = create_model("ItemNote", __base__=ItemNote, key=(key_type, Field(description="An item key from estimate_items")))

    class Finish(ReportDraft):
        improvements: list[note] = Field(default_factory=list, max_length=25, description="A note for each item worth discussing (candidates and items to avoid)")  # type: ignore[valid-type]

        @model_validator(mode="after")
        def _review(self) -> Finish:
            if reviewer is None:
                return self
            issues = reviewer(self)
            if issues:
                listed = "; ".join(f"{i.quote!r}: {i.reason}" if i.quote else i.reason for i in issues)
                raise ValueError(f"fair-housing review found: {listed}. Rewrite those parts about the property's features and buyer needs for features")
            return self

    Finish.__name__ = "ReportDraft"
    return Finish


# ---- the loop ----------------------------------------------------------------------------------

SYSTEM = """\
You write the narrative of a listing-preparation report for a real estate agent: what to change before listing this home, and what it's worth.

Research first, then write:
- Use the tools to look at the property, its market, the confirmed findings, buyer demand, the improvement estimates and the budget plans. Call evidence_gaps to see what research is left; finish when it says done. Don't call the same tool twice with the same input.
- Comparable sales and competing listings may be unavailable: check, and say so plainly.

Numbers:
- Use only numbers the tools returned, written as returned (you may round, and write dollars as $12,500 or $12.5K). Never calculate new numbers: no sums, differences, ratios, multiples ("2 times") or averages.
- Every estimate is a range with a confidence. Low confidence means the figure rests on the team's priors, not local sales. Say so where it matters. Never promise a sale price or a return.

Fair housing (required):
- Describe the property, its condition and its features, and buyer NEEDS for features (more bedrooms, a home office, single-level living, outdoor space). Never describe people: not who would buy or live there, and nothing about race, color, religion, sex, family status or children, disability, national origin, age or any other protected class.
- Never describe the neighborhood's people, safety or character. You may give distances to schools, parks, transit and shops; never rate schools or claim an attendance area.
- Staging advice is about the home: declutter, clear personal items, clean, stage rooms for their use.

Write plainly, without hype. Each section is short (see the finish schema). The item notes explain the reasoning behind the estimates, from each item's evidence. The `gaps` list states every data gap evidence_gaps reported, in plain words."""


def task_facts(world: ReportWorld) -> dict[str, Any]:
    return {"zip": world.zip, "city": world.city, "goal": world.goal.model_dump()}


def task_prompt(world: ReportWorld) -> str:
    return (
        "Prepare the listing-preparation report for this property. Research it with the tools, then call finish."
        f"\nTask JSON:\n{json.dumps(task_facts(world), sort_keys=True)}"
    )


def build_loop(
    llm: LLM,
    world: ReportWorld,
    *,
    budget: LoopBudget = BUDGET,
    review: bool = True,
) -> tuple[AgentLoop[ReportDraft], Toolbox, Reviewer | None]:
    """Shared by the worker and the evals."""
    box = Toolbox(world)
    reviewer = Reviewer(llm) if review else None
    model = finish_model([e.key for e in box.estimates()], reviewer)
    loop = AgentLoop(
        llm,
        tools=build_tools(box),
        result_model=model,
        system=SYSTEM,
        tier=TIER,
        budget=budget,
        guard=number_guard(box),
        fallback=lambda: template_draft(world),
        max_tokens=MAX_TOKENS,
        finish_description="Submit the report's narrative. Call it once, after evidence_gaps says the research is done.",
        purpose="listing_prep.report",
    )
    return loop, box, reviewer


# ---- the deterministic fallback -------------------------------------------------------------------


def _usd(v: float | int | None) -> str:
    return "n/a" if v is None else f"${int(round(v)):,}"


def _join(items: list[str]) -> str:
    if not items:
        return "nothing"
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def outcome_plan(box: Toolbox) -> dict[str, Any] | None:
    """The plan the expected-outcome section is about: the seller's budget, else $10K."""
    target = box.world.goal.budget or OUTCOME_BUDGET
    out = box.optimize_budget(BudgetQuery())
    return next((p for p in out["scenarios"] if p["budget"] == target), None)


def template_draft(world: ReportWorld) -> ReportDraft:
    """The report's narrative in plain wording, every number from the tools. Used when
    there's no model, the loop stops early, the review can't run, or the guard fails twice."""
    box = Toolbox(world)
    prop = box.get_property()
    market = box.get_market_context()
    demand = box.get_buyer_demand()
    findings = box.get_findings(FindingQuery())
    items = box.estimate_items_tool()["items"]
    plans = box.optimize_budget(BudgetQuery())
    gaps = box.evidence_gaps()["data_gaps"]

    v = world.valuation
    snap: list[str] = []
    if v:
        conf = str(v.get("confidence", "low")).capitalize()
        if v.get("interval") == "rough":
            snap.append(f"The rough value range is {_usd(v['low'])} to {_usd(v['high'])}, from ZIP prices per square foot ({conf} confidence); comparable sales would narrow it.")
        else:
            snap.append(f"The value range is {_usd(v['low'])} to {_usd(v['high'])} ({conf} confidence).")
    else:
        snap.append("There isn't enough data for a value range yet.")
    if prop["goal"]["target_price"]:
        snap.append(f"The target price is {_usd(prop['goal']['target_price'])}.")
    rooms = findings["by_room"]
    if rooms:
        worst = min(rooms.items(), key=lambda kv: (kv[1]["average_condition"], kv[0]))
        best = max(rooms.items(), key=lambda kv: (kv[1]["average_condition"], kv[0]))
        snap.append(f"Condition is lowest in the {worst[0]} (average {worst[1]['average_condition']} on the 1 to 5 scale) and highest in the {best[0]} (average {best[1]['average_condition']}).")
    else:
        snap.append("No condition findings have been confirmed yet.")

    if demand.get("available") and demand["segments"]:
        top = demand["segments"][:3]
        buyers = " ".join(f"{s['label']} is {s['share_of_demand_pct']}% of estimated demand; its priorities are {_join(s['priorities'][:2])}." for s in top)
        buyers += " " + PRIVACY_NOTE
    else:
        buyers = "Buyer demand couldn't be sized for this property, so item values aren't weighted by buyer needs."

    zm = market.get("zip_market") or {}
    msp, dom = zm.get("median_sale_price"), zm.get("median_dom")
    mk: list[str] = []
    if msp and msp.get("value") is not None:
        change = f" ({msp['yoy_pct']:+.1f}% year over year)" if msp.get("yoy_pct") is not None else ""
        mk.append(f"In ZIP {world.zip}, the median sale price was {_usd(msp['value'])}{change}, with data through {world.data_through}.")
    if dom and dom.get("value") is not None:
        mk.append(f"The median home there sold in {dom['value']} days.")
    if not mk:
        mk.append("Market figures for this ZIP aren't in the published data.")
    mk.append(NO_MLS)

    notes: list[ItemNote] = []
    for it in items:
        if it["status"] in ("candidate", "avoid"):
            src = f" (team prior: {it['prior_source']})" if it["prior_source"] and len(it["prior_source"]) <= 150 else " (team prior)"
            notes.append(ItemNote(key=it["key"], reasoning=f"{it['label']}: estimated cost {_usd(it['cost_low'])} to {_usd(it['cost_high'])}, value added {_usd(it['value_low'])} to {_usd(it['value_high'])}, {it['confidence'].capitalize()} confidence{src}."))
        elif it["reason"]:
            notes.append(ItemNote(key=it["key"], reasoning=f"{it['label']}: {it['reason']}"))

    scen = plans["scenarios"]
    wanted = [b for b in (world.goal.budget, OUTCOME_BUDGET, 25_000) if b]
    shown = [p for b in dict.fromkeys(wanted) for p in scen if p["budget"] == b][:2]
    bud: list[str] = []
    for p in shown:
        if p["items"]:
            bud.append(f"With {_usd(p['budget'])}, the plan is {_join(p['items'])}, costing up to {_usd(p['cost_high'])} for a risk-adjusted net gain of {_usd(p['risk_adjusted_net'])}.")
        else:
            bud.append(f"With {_usd(p['budget'])}, no item clears the bar, so nothing is spent.")
    bud.append("Money left over is reported, not forced.")
    budget_text = " ".join(bud)

    cands = sorted((i for i in items if i["status"] == "candidate" and i["roi_pct"] is not None), key=lambda i: -i["roi_pct"])[:3]
    roi = " ".join(f"{i['label']} returns an estimated {i['roi_pct']}% on its expected cost, risk-adjusted." for i in cands) or "No item has a positive risk-adjusted return with the current priors and prices."
    avoid_items = plans["avoid"]
    avoid = " ".join(f"Avoid {a['label'].lower()}: it doesn't pay for itself at the conservative end of its range." for a in avoid_items[:3]) or "No priced item loses money at the conservative end of its range."

    pri = demand["segments"][0]["priorities"][:3] if demand.get("available") and demand["segments"] else []
    strategy = Strategy(
        staging="Clean and declutter every room, clear personal items from counters and walls, and stage the main living areas so each room's use is clear.",
        shot_list=["Front exterior in daylight", "Kitchen from its widest angle", "Living room with natural light", "Primary bedroom", "Primary bath", "Back yard or outdoor space"],
        positioning=(f"Lead with the features that matter most at this price: {_join(pri)}." if pri else "Lead with the home's updated and well-kept features, room by room."),
        description_angles=[p[:1].upper() + p[1:] for p in pri[:3]] if len(pri) >= 2 else ["The home's layout and room sizes", "Its condition and recent updates"],
    )

    plan = outcome_plan(box)
    if plan and plan["items"]:
        out = f"With the {_usd(plan['budget'])} plan, spending up to {_usd(plan['cost_high'])} on {_join(plan['items'])} has a risk-adjusted net benefit of {_usd(plan['risk_adjusted_net'])}."
        if plan["value_after_low"] is not None and v:
            out += f" The estimated range after the work is {_usd(plan['value_after_low'])} to {_usd(plan['value_after_high'])}, compared with {_usd(v['low'])} to {_usd(v['high'])} now."
    else:
        out = "No preparation plan clears the bar with the current priors and prices, so the expected outcome is the home as it is."
    return ReportDraft(
        snapshot=" ".join(snap),
        buyers=buyers,
        market=" ".join(mk),
        improvements=notes,
        budget=budget_text,
        highest_roi=roi,
        avoid=avoid,
        strategy=strategy,
        outcome=out,
        gaps=[f"{g['gap']}. To fix: {g['fix'][:1].lower() + g['fix'][1:]}" for g in gaps][:8],
    )


# ---- running and assembling ---------------------------------------------------------------------


def run_report(llm: LLM | None, world: ReportWorld, *, budget: LoopBudget = BUDGET) -> dict[str, Any]:
    """The finished report (`assemble`). Without a model, the template narrative."""
    if llm is None:
        return assemble(world, template_draft(world), source="template", warnings=["No Anthropic key: the narrative is the plain template."])
    loop, box, reviewer = build_loop(llm, world, budget=budget)
    result: LoopResult[ReportDraft] = loop.run(task_prompt(world))
    warnings: list[str] = []
    draft: ReportDraft
    if result.ok and result.result is not None and result.narrative_source == "llm":
        if reviewer is not None and reviewer.last_ok is not True:
            draft, source = template_draft(world), "template"
            warnings.append("The fair-housing review couldn't run, so the narrative is the plain template.")
        else:
            draft, source = result.result, "llm"
    else:
        draft, source = template_draft(world), "template"
        if result.ok:
            warnings.append("The narrative didn't pass the number check twice, so it's the plain template.")
        else:
            warnings.append(f"The research stopped early ({result.stop_reason}), so the narrative is the plain template.")
    return assemble(world, draft, source=source, result=result, warnings=warnings, review_calls=reviewer.calls if reviewer else 0, usd=result.usd + (reviewer.usd if reviewer else 0.0))


def assemble(
    world: ReportWorld,
    draft: ReportDraft,
    *,
    source: str,
    result: LoopResult[Any] | None = None,
    warnings: list[str] | None = None,
    review_calls: int = 0,
    usd: float = 0.0,
) -> dict[str, Any]:
    """The report (§7): every figure from a fresh computation over the same snapshot, the
    narrative alongside. This is what the Desk stores and P6 shows."""
    box = Toolbox(world)
    est = box.estimate_items_tool()["items"]
    plans = box.optimize_budget(BudgetQuery())
    demand = box.get_buyer_demand()
    findings = box.get_findings(FindingQuery())
    market = box.get_market_context()
    gaps = box.data_gaps()
    notes = {n.key: n.reasoning for n in draft.improvements}
    for it in est:
        it["reasoning"] = notes.get(it["key"])
    weak = sorted(world.findings, key=lambda f: (int(f.get("condition", 3)), str(f.get("room"))))[:5]
    strong = [room for room, s in findings["by_room"].items() if s["average_condition"] >= 4]
    ranked = sorted((i for i in est if i["status"] == "candidate" and i["roi_pct"] is not None), key=lambda i: -i["roi_pct"])
    plan = outcome_plan(box)
    v = world.valuation
    model = tier_config(TIER).model if source == "llm" else None
    return {
        "prompt_version": PROMPT_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "narrative_source": source,
        "model": model,
        "stop_reason": result.stop_reason if result is not None else "not_run",
        "steps": result.steps if result is not None else 0,
        "tools_called": result.tools_called() if result is not None else [],
        "review_calls": review_calls,
        "cost_usd": round(usd, 6),
        "warnings": warnings or [],
        "goal": world.goal.model_dump(),
        "sections": {
            "snapshot": {"valuation": v, "target_price": world.goal.target_price, "strengths": strong, "weaknesses": [{"room": room_label(f.get("room")), "issue": f.get("issue"), "condition": f.get("condition")} for f in weak], "narrative": draft.snapshot},
            "buyers": {"available": demand.get("available", False), "segments": demand.get("segments", []), "note": PRIVACY_NOTE, "narrative": draft.buyers},
            "market": {"data_through": world.data_through, "zip": world.zip, "zip_market": market["zip_market"], "city": world.city, "city_market": market["city_market"], "comparables": {"available": False, "reason": NO_MLS}, "competing": {"available": False, "reason": NO_MLS}, "narrative": draft.market},
            "improvements": {"items": est},
            "budget": {"scenarios": plans["scenarios"], "marginal": plans["marginal"], "narrative": draft.budget},
            "highest_roi": {"ranked": [{"key": i["key"], "label": i["label"], "roi_pct": i["roi_pct"], "risk_adjusted_net": i["risk_adjusted_net"], "confidence": i["confidence"]} for i in ranked], "narrative": draft.highest_roi},
            "avoid": {"items": [i for i in est if i["status"] == "avoid"], "narrative": draft.avoid},
            "strategy": {**draft.strategy.model_dump(), "fair_housing": "rules and review" if source == "llm" else "rules (fixed wording)"},
            "outcome": {"plan": plan, "value_now": {"low": v["low"], "high": v["high"]} if v else None, "narrative": draft.outcome},
        },
        "gaps": {"data": gaps, "narrative": draft.gaps},
        "methodology": [
            "Value range: " + (f"{v.get('method')}, {v.get('interval')} interval, {v.get('confidence')} confidence." if v else "not available."),
            "Costs: quotes for this home first, then the team's cost book × quantities from the confirmed findings.",
            "Values: the team's value priors (share of cost recovered at resale, with their sources) × a buyer-relevance factor of at most ±10%. Low confidence uses the conservative end.",
            "Plans: an exact optimizer over the candidate items (one option per group, prerequisites paid once), planned against the high cost.",
            "Every figure is computed in code; the narrative is checked against those figures, screened for fair housing, and replaced by plain wording when a check fails.",
        ],
        "sources": world.sources,
        "disclaimer": DISCLAIMER,
    }


