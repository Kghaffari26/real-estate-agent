"""Photo → structured condition findings (Listing Prep P2, SPEC_LISTING_PREP.md §4 step 3).

One model call per photo, through `agents_core.llm` (`converse`, because the request
carries an image; `structured` takes text only). The model must answer by calling
`record_photo_findings`; its input is validated against `PhotoAnalysis` here, then:

  * people visible            → the photo is skipped with a note, no findings kept;
  * unusable (dark, blurry…)  → skipped with a note;
  * otherwise each finding is screened by `fair_housing` (dropped if it touches a
    forbidden topic), its cost book item checked against the team's items, and its
    evidence box clamped to the photo.

Only the scope the owner set is allowed: property condition and fixes. Free text the
model writes outside a finding's `issue` / `suggested_fix` is never stored; photo notes
are ours. Bump PROMPT_VERSION when the prompt, the tool or these checks change.
"""

from __future__ import annotations

import base64
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from agents.listing_prep import fair_housing

PROMPT_VERSION = "p2-findings-1"
TIER = "fast"
MAX_TOKENS = 1500
MAX_FINDINGS = 12

Category = Literal[
    "paint", "walls_ceilings", "flooring", "lighting", "fixtures_hardware", "cabinets", "countertops",
    "appliances", "windows_doors", "storage", "bath", "landscaping", "exterior", "roof_gutters",
    "curb_appeal", "decluttering", "cleaning", "repair", "staging", "other",
]


class Box(BaseModel):
    x: float = Field(ge=0, le=1, description="Left edge, as a fraction of the photo's width")
    y: float = Field(ge=0, le=1, description="Top edge, as a fraction of the photo's height")
    w: float = Field(gt=0, le=1, description="Width, as a fraction of the photo's width")
    h: float = Field(gt=0, le=1, description="Height, as a fraction of the photo's height")


class VisionFinding(BaseModel):
    category: Category
    condition: int = Field(ge=1, le=5, description="1 = needs replacing, 3 = average wear, 5 = like new")
    issue: str = Field(min_length=3, max_length=300, description="What is visibly wrong or dated, in plain words")
    suggested_fix: str | None = Field(default=None, max_length=300, description="The fix that would help the home sell")
    fix_item: str | None = Field(default=None, description="The cost book item key for the fix, if one fits")
    quantity: float | None = Field(default=None, ge=0, description="How many units of fix_item, if you can estimate it")
    severity: Literal["cosmetic", "minor_repair", "major_repair"]
    evidence: Box = Field(description="A box around the visible evidence")
    confidence: Literal["high", "medium", "low"]


class PhotoAnalysis(BaseModel):
    people_visible: bool = Field(description="True if any person, or part of one, is visible, including reflections")
    usable: bool = Field(description="False if the photo is too dark, blurry, or not of this property")
    findings: list[VisionFinding] = Field(default_factory=list, max_length=MAX_FINDINGS)


TOOL = {
    "name": "record_photo_findings",
    "description": "Record what this photo shows about the property's condition. Call it exactly once.",
    "input_schema": PhotoAnalysis.model_json_schema(),
}

SYSTEM = """You inspect photos of a home that is being prepared for sale, for its physical condition.

Report only the property's condition and the fixes that would help it sell: paint, walls and ceilings,
flooring, lighting, fixtures and hardware, cabinets, countertops, appliances, windows and doors, storage,
baths, landscaping, exterior, roof and gutters, curb appeal, decluttering, cleaning, repairs, staging.

Rules (fair housing and privacy):
- If any person, or any part of a person, is visible, including in a mirror or window reflection, set
  people_visible to true and return no findings.
- Never mention or infer anything about who lives in the home or who would buy it: no age, sex, family or
  children, race, color, religion, national origin, disability, health, or politics.
- Never describe belongings that reveal such details (religious items, holiday decorations, family photos,
  toys, flags, medical equipment, mail or documents). If the room needs decluttering, say so generically,
  e.g. "clear personal items from the counters".
- Never comment on the neighborhood, neighbors, schools, safety or "who the home is good for".

How to report:
- One finding per visible issue, at most 12, most important first. Describe only what you can see.
- condition: 1 = needs replacing, 2 = worn or dated, 3 = average wear, 4 = good, 5 = like new.
- suggested_fix: the practical fix; fix_item: the matching key from the cost book list, or null.
- evidence: a box around what shows the issue, as fractions of the photo's width and height.
- If the photo is too dark, blurry, or isn't of this property, set usable to false.
Call record_photo_findings exactly once."""


@dataclass
class PhotoOutcome:
    outcome: Literal["analyzed", "skipped_people", "skipped_unusable"]
    findings: list[VisionFinding] = field(default_factory=list)
    dropped_fair_housing: int = 0
    note: str | None = None
    usd: float = 0.0


NOTES = {
    "skipped_people": "People are visible in this photo, so it wasn’t analyzed. Retake it with nobody in the frame.",
    "skipped_unusable": "This photo couldn’t be analyzed (too dark, blurry, or not of the property). Retake it.",
    "no_answer": "The analysis didn’t return a usable answer for this photo. Run it again later.",
}


def build_messages(image_jpeg: bytes, room: str, cost_items: Mapping[str, str]) -> list[dict[str, Any]]:
    book = "\n".join(f"- {k} ({unit})" for k, unit in sorted(cost_items.items())) or "(none yet)"
    return [
        {
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(image_jpeg).decode()}},
                {"type": "text", "text": f"The agent labelled this photo: {room.replace('_', ' ')}.\n\nCost book items (key, unit):\n{book}"},
            ],
        }
    ]


def parse_turn(tool_uses: list[dict[str, Any]]) -> PhotoAnalysis | None:
    for use in tool_uses:
        if use.get("name") == TOOL["name"]:
            try:
                return PhotoAnalysis.model_validate(use.get("input") or {})
            except ValidationError:
                return None
    return None


def screen(analysis: PhotoAnalysis, cost_items: Mapping[str, str]) -> PhotoOutcome:
    """Apply the scope rules to a validated answer (pure; unit-tested on its own)."""
    if analysis.people_visible:
        return PhotoOutcome("skipped_people", note=NOTES["skipped_people"])
    if not analysis.usable:
        return PhotoOutcome("skipped_unusable", note=NOTES["skipped_unusable"])
    kept: list[VisionFinding] = []
    dropped = 0
    for f in analysis.findings:
        if fair_housing.screen([f.issue, f.suggested_fix or ""]):
            dropped += 1
            continue
        box = f.evidence
        clamped = Box(x=box.x, y=box.y, w=min(box.w, 1 - box.x) or 0.01, h=min(box.h, 1 - box.y) or 0.01)
        kept.append(f.model_copy(update={"evidence": clamped, "fix_item": f.fix_item if f.fix_item in cost_items else None}))
    note = None
    if dropped:
        note = f"{dropped} finding{'s' if dropped != 1 else ''} left out by the fair-housing check (condition and fixes only)."
    return PhotoOutcome("analyzed", kept, dropped, note)


def analyze_photo(llm: Any, image_jpeg: bytes, room: str, cost_items: Mapping[str, str], *, budget: Any = None) -> PhotoOutcome:
    """One photo, one call (one retry if the answer isn't a valid tool call)."""
    messages = build_messages(image_jpeg, room, cost_items)
    usd = 0.0
    for _ in range(2):
        turn = llm.converse(TIER, messages, system=SYSTEM, tools=[TOOL], max_tokens=MAX_TOKENS, purpose="listing_prep.findings", temperature=0, budget=budget)
        usd += turn.usd
        if turn.stop_reason == "refusal":
            break
        analysis = parse_turn(turn.tool_uses)
        if analysis is not None:
            out = screen(analysis, cost_items)
            out.usd = usd
            return out
    return PhotoOutcome("skipped_unusable", note=NOTES["no_answer"], usd=usd)
