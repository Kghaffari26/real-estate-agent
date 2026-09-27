"""Brief generation (SPEC_REAL_ESTATE.md §7): facts dicts, prompts, the LLM
paths through `agents_core.llm`, and the deterministic template fallbacks.

- Metro briefs: fast tier through the Batch API (`ctx.llm.batch` +
  `ctx.llm.guard_batch`), only for metros whose facts hash changed. If the batch
  doesn't end within `batch_poll_timeout_min`, agents-core cancels it and reruns
  the requests synchronously, 5 at a time (`on_timeout="sync"`, §7.4 step 5).
- National brief: smart tier, synchronous (`ctx.llm.structured`).

Every LLM result goes through `fields_guard(facts, ["text", "key_points"])`: a
number that isn't in the facts triggers one retry naming it, then the template
from `templates.py` (`narrative_source: "template"`). Numbers are never
computed here — the facts dicts carry values `compute.py` already produced,
pre-formatted into human units (§7.2).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from agents_core.costs import Tier
from agents_core.guards import GuardResult, extract_numbers, fields_guard
from agents_core.llm import LLM, BatchItem, Guarded, LLMError, tier_config

from agents.real_estate import templates
from agents.real_estate.schema import Brief, BriefDraft, Citation

log = logging.getLogger(__name__)

REDFIN_CITATION = Citation(
    name="Redfin Data Center",
    url="https://www.redfin.com/news/data-center/",
    attribution="Data: Redfin, a national real estate brokerage.",
)
ZILLOW_CITATION = Citation(
    name="Zillow Research",
    url="https://www.zillow.com/research/data/",
    attribution="Zillow Home Value Index (ZHVI) and Zillow Observed Rent Index (ZORI), Zillow Research.",
)
FRED_CITATION = Citation(
    name="FRED, Federal Reserve Bank of St. Louis", url="https://fred.stlouisfed.org/"
)

# Metro facts the brief hash (and so the metro prompt) leaves out: a mortgage-rate
# move alone must not regenerate 50 briefs, so briefs must not quote figures that
# move with it (§10 "Redfin 304, rate changed").
RATE_DEPENDENT_KEYS = ("rates", "affordability")
BRIEF_FIELDS = ["text", "key_points"]
# Numbers that appear in fixed phrases rather than in the facts.
GUARD_ALLOW = ("50 largest metros", "50 tracked metros", "of 50 metros")
METRO_MAX_TOKENS = 600
NATIONAL_MAX_TOKENS = 4000

METRO_SYSTEM = """\
You write short, neutral housing market briefs for a public dashboard.
- Use only numbers from the facts JSON, written exactly as given (you may round to fewer decimals). Never calculate new numbers: no differences, sums, ratios or conversions.
- Write 3-4 sentences, at most 90 words. Lead with the most important change.
- Percent changes are "%"; changes in shares (fields ending in _pp) are "pp"; days on market are "days".
- Mention every entry in "flags" if you can do so naturally.
- No predictions, no advice, no hype words. Say "relative to the 50 largest metros" when you mention temperature.
- Return JSON {"text": str, "key_points": [str]} with at most 3 key points of 12 words or fewer each."""

NATIONAL_SYSTEM = """\
You write the national summary for a public U.S. housing market dashboard that tracks the 50 largest metros.
- Use only numbers from the input JSON, written exactly as given (you may round to fewer decimals). Never calculate new numbers: no differences, sums, ratios or conversions.
- Write 4-6 sentences. Lead with the most important national change, then cover the two top alerts and the mortgage rate.
- Percent changes are "%"; changes in shares (fields ending in _pp) are "pp".
- No predictions, no advice, no hype words.
- Return JSON {"text": str, "key_points": [str]} with exactly 3 key points of 12 words or fewer each."""


def to_pct(ratio: float | None) -> float | None:
    """Convert a stored ratio (0.031) into the facts dict's human units (3.1)."""
    return None if ratio is None else round(ratio * 100, 1)


def build_metro_facts(
    *,
    metro_name: str,
    data_through: str,
    median_sale_price: dict[str, Any],
    inventory: dict[str, Any],
    median_dom: dict[str, Any],
    price_drops: dict[str, Any],
    sale_to_list: dict[str, Any],
    months_of_supply_value: float | None,
    months_of_supply_yoy: float | None,
    zori: dict[str, Any] | None,
    temperature_label: str | None,
    temperature_score: int | None,
    market_type: str | None,
    flag_labels: list[str],
    mortgage30_pct: float | None,
    mortgage30_year_ago_pct: float | None,
    payment_now: float | None,
    payment_change_pct: float | None,
) -> dict[str, Any]:
    """Assembles the SPEC §7.2 facts dict: every number pre-formatted into
    human units so the LLM never has to convert anything, and the guard can
    compare against exactly these numbers."""
    metrics: dict[str, dict[str, Any]] = {
        "median_sale_price": {
            "value": median_sale_price.get("value"),
            "yoy_pct": to_pct(median_sale_price.get("yoy")),
        },
        "inventory": {"value": inventory.get("value"), "yoy_pct": to_pct(inventory.get("yoy"))},
        "median_dom": {"value": median_dom.get("value"), "yoy_days": median_dom.get("yoy")},
        "price_drops_share_pct": {
            "value": to_pct(price_drops.get("value")),
            "yoy_pp": to_pct(price_drops.get("yoy")),
        },
        "sale_to_list_pct": {
            "value": to_pct(sale_to_list.get("value")),
            "yoy_pp": to_pct(sale_to_list.get("yoy")),
        },
        "months_of_supply": {"value": months_of_supply_value, "yoy": months_of_supply_yoy},
    }
    if zori is not None and zori.get("value") is not None:
        metrics["zori_rent"] = {"value": zori.get("value"), "yoy_pct": to_pct(zori.get("yoy"))}

    return {
        "metro": metro_name,
        "data_through": data_through,
        "metrics": metrics,
        "temperature": {
            "label": temperature_label,
            "score": temperature_score,
            "relative_to": "50 largest metros",
        },
        "market_type": market_type,
        "flags": flag_labels,
        "rates": {"mortgage30_pct": mortgage30_pct, "mortgage30_year_ago_pct": mortgage30_year_ago_pct},
        "affordability": {"payment_now": payment_now, "payment_change_pct": to_pct(payment_change_pct)},
    }


def metro_cache_facts(facts: dict[str, Any]) -> dict[str, Any]:
    """The facts a metro brief is generated from and hashed on: §7.2's dict minus
    the rate-dependent blocks (see `RATE_DEPENDENT_KEYS`)."""
    return {k: v for k, v in facts.items() if k not in RATE_DEPENDENT_KEYS}


def build_national_input(
    national_facts: dict[str, Any],
    alerts: list[dict[str, Any]],
    movers: dict[str, list[dict[str, Any]]],
    mover_counts: dict[str, int],
    total_metros: int,
) -> dict[str, Any]:
    """§7.5's input: national facts, the top 5 alerts, the movers and the counts.
    `movers` maps a group to `[{"name", "value": YoY ratio}]`, converted here to
    the facts' human units."""
    return {
        **national_facts,
        "top_alerts": [
            {
                "label": a["label"],
                "severity": a["severity"],
                "metros": len(a.get("slugs", [])),
                # each metro's own figure (the group label is only the threshold)
                "examples": [
                    {"metro": m["name"], "label": m["label"]} for m in a.get("metros", [])[:3]
                ],
            }
            for a in alerts[:5]
        ],
        "movers": {
            key: [{"metro": e["name"], "yoy_pct": to_pct(e["value"])} for e in entries[:3]]
            for key, entries in movers.items()
        },
        "counts": {**{f"metros that {label}": n for label, n in mover_counts.items()}, "tracked_metros": total_metros},
    }


def guard_facts(facts: dict[str, Any]) -> dict[str, Any]:
    """Every number the guard accepts: the facts' numeric values, plus numbers
    embedded in their string values (flag and alert labels like "Inventory +21%
    YoY" are computed by `flags.py`, so quoting them is fine)."""
    embedded: list[float] = []

    def walk(x: Any) -> None:
        if isinstance(x, str):
            embedded.extend(t.value * t.scale for t in extract_numbers(x))
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    walk(facts)
    return {"facts": facts, "label_numbers": embedded}


def brief_guard(facts: dict[str, Any]) -> Callable[[Any], GuardResult]:
    return fields_guard(guard_facts(facts), BRIEF_FIELDS, allow=GUARD_ALLOW)


def _prompt(label: str, payload: dict[str, Any]) -> str:
    return f"{label}:\n{json.dumps(payload, ensure_ascii=False, sort_keys=True)}"


def metro_prompt(facts: dict[str, Any]) -> str:
    return _prompt("Facts JSON", metro_cache_facts(facts))


def national_prompt(national_input: dict[str, Any]) -> str:
    return _prompt("Input JSON", national_input)


def _metro_citations(facts: dict[str, Any]) -> list[Citation]:
    citations = [REDFIN_CITATION]
    if "zori_rent" in facts["metrics"]:
        citations.append(ZILLOW_CITATION)
    return citations


def _to_brief(
    guarded: Guarded[BriefDraft], citations: list[Citation], model: str
) -> Brief:
    draft = guarded.value
    return Brief(
        text=draft.text.strip(),
        key_points=[k.strip() for k in draft.key_points if k.strip()][:3],
        citations=citations,
        narrative_source=guarded.narrative_source,
        model=model if guarded.narrative_source == "llm" else None,
        generated_at=datetime.now(UTC),
        reused=False,
    )


# ---- template path (fallback, and the free offline evals) -------------------


def template_metro_draft(facts: dict[str, Any]) -> BriefDraft:
    return BriefDraft(**templates.metro_brief(facts))


def template_national_draft(
    facts: dict[str, Any], alerts: list[dict[str, Any]], mover_counts: dict[str, int]
) -> BriefDraft:
    return BriefDraft(**templates.national_brief(facts, alerts, mover_counts))


def generate_metro_brief(facts: dict[str, Any], *, reused: bool) -> Brief:
    """Template-only metro brief (no LLM)."""
    draft = template_metro_draft(facts)
    return Brief(
        text=draft.text,
        key_points=draft.key_points,
        citations=_metro_citations(facts),
        narrative_source="template",
        model=None,
        generated_at=datetime.now(UTC),
        reused=reused,
    )


def generate_national_brief(
    facts: dict[str, Any], alerts: list[dict[str, Any]], mover_counts: dict[str, int]
) -> Brief:
    """Template-only national brief (no LLM)."""
    draft = template_national_draft(facts, alerts, mover_counts)
    return Brief(
        text=draft.text,
        key_points=draft.key_points,
        citations=[REDFIN_CITATION, FRED_CITATION],
        narrative_source="template",
        model=None,
        generated_at=datetime.now(UTC),
        reused=False,
    )


def reuse_brief(prior: dict[str, Any]) -> Brief:
    """Rebuilds a `Brief` from a cached/previously published `brief` block,
    marking it `reused=True` — no template or LLM call is made."""
    data = dict(prior)
    data["reused"] = True
    return Brief.model_validate(data)


# ---- LLM path ---------------------------------------------------------------


def _structured_or_template(
    llm: LLM,
    tier: Tier,
    prompt: str,
    *,
    system: str,
    max_tokens: int,
    purpose: str,
    guard: Callable[[Any], GuardResult],
    fallback: Callable[[], BriefDraft],
) -> Guarded[BriefDraft]:
    """`llm.structured` with a guard, where an unusable first response (refusal,
    truncation, schema mismatch: `LLMError`) also falls back to the template
    instead of failing the run. API/auth errors and `BudgetExceeded` still raise."""
    try:
        return llm.structured(
            tier,
            prompt,
            BriefDraft,
            system=system,
            max_tokens=max_tokens,
            purpose=purpose,
            guard=guard,
            fallback=fallback,
        )
    except LLMError as exc:
        log.warning("%s: unusable LLM output (%s); using template", purpose, exc)
        return Guarded(fallback(), "template", attempts=1)


SYNC_CONCURRENCY = 5  # §7.4: a timed-out batch reruns synchronously, 5 at a time


def llm_metro_briefs(
    llm: LLM,
    facts_by_slug: dict[str, dict[str, Any]],
    *,
    batch_timeout_seconds: float,
    poll_seconds: float = 30.0,
) -> tuple[dict[str, Brief], bool]:
    """Metro briefs for `facts_by_slug` via the Batch API (fast tier), guarded,
    with per-metro template fallback. Returns `(briefs, batch_fallback)`, where
    `batch_fallback` is True if the batch timed out and agents-core reran the
    requests synchronously (`on_timeout="sync"`, §7.4 step 5).
    """
    if not facts_by_slug:
        return {}, False
    items = [
        BatchItem(custom_id=slug, prompt=metro_prompt(facts), max_tokens=METRO_MAX_TOKENS)
        for slug, facts in facts_by_slug.items()
    ]
    guards = {slug: brief_guard(metro_cache_facts(f)) for slug, f in facts_by_slug.items()}

    def fallback(slug: str) -> BriefDraft:
        return template_metro_draft(facts_by_slug[slug])

    results = llm.batch(
        "fast",
        items,
        system=METRO_SYSTEM,
        output_model=BriefDraft,
        purpose="metro_brief",
        poll_seconds=poll_seconds,
        timeout_seconds=batch_timeout_seconds,
        on_timeout="sync",
        max_concurrency=SYNC_CONCURRENCY,
    )
    batch_fallback = any(r.via == "sync" for r in results.values())
    guarded = llm.guard_batch(
        "fast",
        items,
        results,
        system=METRO_SYSTEM,
        output_model=BriefDraft,
        guard=lambda slug, value: guards[slug](value),
        fallback=fallback,
        purpose="metro_brief",
        max_concurrency=SYNC_CONCURRENCY,
    )
    model = tier_config("fast").model
    briefs = {
        slug: _to_brief(guarded[slug], _metro_citations(facts), model)
        for slug, facts in facts_by_slug.items()
    }
    return briefs, batch_fallback


def llm_national_brief(
    llm: LLM,
    national_input: dict[str, Any],
    template_fallback: Callable[[], BriefDraft],
) -> Brief:
    """The national brief (smart tier, synchronous), guarded against `national_input`."""
    guarded = _structured_or_template(
        llm,
        "smart",
        national_prompt(national_input),
        system=NATIONAL_SYSTEM,
        max_tokens=NATIONAL_MAX_TOKENS,
        purpose="national_brief",
        guard=brief_guard(national_input),
        fallback=template_fallback,
    )
    return _to_brief(guarded, [REDFIN_CITATION, FRED_CITATION], tier_config("smart").model)
