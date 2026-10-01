"""The fair-housing screen for photo findings (SPEC_LISTING_PREP.md §3; owner review).

Findings describe the property's condition and fixes, nothing else. Every finding's text
(`issue`, `suggested_fix`) is screened here before it is stored; one that touches a
forbidden topic is dropped (never rewritten), and the photo's note says how many were
left out. The prompt asks the model to stay in scope; this is the check that doesn't
depend on the model listening.

Forbidden topics:
  people        anyone in or around the home: occupants, their age, sex, family
  familial      belongings or rooms that reveal children or family status
  religion      religious items, holidays, places of worship
  origin        race, color as a trait of people, ethnicity, national origin, flags
  sex           sex, gender, orientation
  disability    disability, health, medical equipment, medication
  personal      documents and keepsakes that identify people
  politics      political material
  neighborhood  the neighborhood's residents, safety, schools or "character"
  steering      who the home would suit

The rules are deliberately conservative: a false alarm costs one finding the agent can
add back by hand; a miss puts a fair-housing problem into a report. The labelled cases
in `evals/listing_prep/fair_housing_cases.jsonl` pin both directions (pytest runs them).
"""

from __future__ import annotations

import re
from collections.abc import Iterable

_W = r"(?<![\w'])"  # word start
_E = r"(?!\w)"  # word end (a trailing apostrophe still ends a word: "neighbors'")


def _words(*words: str) -> str:
    return _W + "(?:" + "|".join(words) + ")" + _E


RULES: dict[str, re.Pattern[str]] = {
    "people": re.compile(
        _words(
            r"people", r"person", r"persons", r"man(?! doors?)", r"men", r"woman", r"women", r"girls?", r"boys?",
            r"husband", r"wife", r"couples?(?! of)", r"residents?", r"occupants?", r"tenants?", r"inhabitants?",
            r"homeowners? (?:is|are|was|were|who|appears?|seems?)", r"someone", r"somebody", r"elderly", r"seniors?",
            r"senior citizens?", r"retirees?", r"young (?:couple|family|families|people|professionals?)", r"adults?",
            r"famil(?:y|ies)(?! rooms?)",
        ),
        re.I,
    ),
    "familial": re.compile(
        _words(
            r"child(?:ren)?(?:'s)?", r"kids?(?:'s|')?", r"bab(?:y|ies)(?:'s)?", r"toddlers?", r"teens?", r"teenagers?",
            r"infants?", r"cribs?", r"nursery", r"strollers?", r"high ?chairs?", r"toys?", r"playpens?",
            r"pregnan(?:t|cy)", r"newlyweds?", r"empty nesters?", r"bachelors?",
        ),
        re.I,
    ),
    "religion": re.compile(
        _words(
            r"relig(?:ion|ious)", r"church(?:es)?", r"mosques?", r"synagogues?", r"temples?", r"crucifix(?:es)?",
            r"cross(?:es)? (?:on|hanging|above|over)", r"menorahs?", r"mezuzahs?", r"bibles?", r"qur'?an", r"koran",
            r"torah", r"rosar(?:y|ies)", r"prayer(?: (?:rug|mat|room|beads))?s?", r"altars?", r"shrines?",
            r"buddh(?:a|ist)s?", r"hindu", r"christian", r"muslim", r"islamic", r"jewish", r"catholic", r"sikh",
            r"christmas", r"hanukkah", r"chanukah", r"diwali", r"ramadan", r"easter", r"kwanzaa", r"nativity",
            r"idols?", r"deit(?:y|ies)",
        ),
        re.I,
    ),
    "origin": re.compile(
        _words(
            r"race", r"racial", r"ethnic(?:ity)?", r"african[- ]american", r"asian", r"hispanic", r"latin[oax]s?",
            r"caucasian", r"(?:black|white|brown) (?:people|family|families|residents|neighborhood|community)",
            r"immigrants?", r"foreign(?:ers?)?", r"nationality", r"national origin", r"flags?", r"heritage",
            r"cultural", r"ethnic decor",
        ),
        re.I,
    ),
    "sex": re.compile(
        _words(r"gender", r"feminine", r"masculine", r"man cave", r"she ?shed", r"lgbtq?\+?", r"gay", r"lesbian",
               r"transgender", r"his and hers", r"girly", r"manly"),
        re.I,
    ),
    "disability": re.compile(
        _words(
            r"disab(?:led|ility|ilities)", r"handicap(?:ped)?", r"wheelchairs?", r"walkers?", r"crutch(?:es)?",
            r"hospital beds?", r"oxygen", r"medical (?:equipment|supplies|devices?)", r"medications?", r"medicines?",
            r"pills?", r"prescriptions?", r"mobility aids?", r"mental(?:ly)? (?:ill|health)", r"illness",
            r"sick", r"patients?",
        ),
        re.I,
    ),
    "personal": re.compile(
        _words(
            r"family (?:photos?|pictures?|portraits?)", r"portraits?", r"photos? of (?:the )?(?:owners?|family|people|kids|children)",
            r"diplomas?", r"certificates?", r"mail", r"letters?", r"bills", r"documents?", r"names?", r"license plates?",
            r"calendars?", r"trophies", r"trophy", r"jerseys?",
        ),
        re.I,
    ),
    "politics": re.compile(
        _words(r"politic(?:al|s)", r"campaign", r"vot(?:e|es|ing|er|ers)", r"election", r"protest", r"democrat(?:ic)?",
               r"republican", r"partisan"),
        re.I,
    ),
    "neighborhood": re.compile(
        _words(
            r"neighbou?rhoods?", r"neighbou?rs?", r"communit(?:y|ies)", r"demographics?", r"crime",
            r"safe (?:area|street|place|for)", r"good area", r"bad area", r"up[- ]and[- ]coming", r"gentrif\w*",
            r"exclusive", r"school(?:s|ing)?", r"district", r"diverse", r"diversity", r"integrated",
            r"(?:quiet|nice|good|bad|rough|desirable|undesirable) (?:area|street|block|part of town)",
        ),
        re.I,
    ),
    "steering": re.compile(
        r"(?:perfect|ideal|great|suited|suitable|made|good) for (?:a |an |the )?"
        r"(?:young|growing|first|single|singles|retire\w*|famil\w*|couples?|kids|child\w*|seniors?|empty|"
        r"profession\w*|students?|investors?|buyers?|people|someone|those|anyone|entertaining guests)|"
        r"would (?:suit|appeal to|attract)|target (?:buyer|market|audience)",
        re.I,
    ),
}


def violations(text: str) -> list[str]:
    """The forbidden topics a text touches (empty when it's fine)."""
    return [topic for topic, rule in RULES.items() if rule.search(text or "")]


def screen(texts: Iterable[str]) -> list[str]:
    """Topics touched by any of several texts, in RULES order, without repeats."""
    found = {t for text in texts for t in violations(text)}
    return [t for t in RULES if t in found]
