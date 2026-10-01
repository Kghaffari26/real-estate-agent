"""The improvement catalog (Listing Prep P4, SPEC_LISTING_PREP.md §5.4).

One entry per cost book item (`docs/templates/cost_book.csv`): what it fixes (finding
categories), how its quantity is found when a finding doesn't give one, how long it
takes, which other items it's an alternative to (`group`: pick at most one), what it
needs first (`requires`), and which buyer needs it serves (for relevance, §5.3).

The catalog holds no prices and no value figures: prices are the team's cost book or
a quote, and value priors are the team's own table (see `improvements.py`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

QuantityRule = Literal["finding", "floor_area", "per_finding", "one", "months", "hours"]


@dataclass(frozen=True)
class CatalogItem:
    key: str
    label: str
    categories: frozenset[str]  # finding categories this item can fix
    quantity: QuantityRule  # how to size it when the findings give no quantity
    days: int  # working days to complete (before listing)
    group: str | None = None  # alternatives: at most one per group
    requires: frozenset[str] = field(default_factory=frozenset)  # prerequisite items
    needs: frozenset[str] = field(default_factory=frozenset)  # buyer needs it serves (demand.SEGMENTS keys)
    always: bool = False  # a candidate for every listing (prep), findings or not


def _i(key: str, label: str, cats: str, qty: QuantityRule, days: int, **kw: object) -> CatalogItem:
    return CatalogItem(
        key,
        label,
        frozenset(cats.split()),
        qty,
        days,
        group=kw.get("group"),  # type: ignore[arg-type]
        requires=frozenset(str(kw.get("requires", "")).split()),
        needs=frozenset(str(kw.get("needs", "")).split()),
        always=bool(kw.get("always", False)),
    )


ITEMS: tuple[CatalogItem, ...] = (
    _i("interior_paint_walls", "Interior paint (walls)", "paint walls_ceilings", "floor_area", 5, needs="low_maintenance luxury", requires="minor_repairs_handyman"),
    _i("interior_paint_trim_doors", "Interior paint (trim and doors)", "paint", "per_finding", 3),
    _i("exterior_paint", "Exterior paint", "exterior curb_appeal", "floor_area", 7, needs="low_maintenance", requires="pressure_washing"),
    _i("cabinet_refinish", "Refinish kitchen cabinets", "cabinets", "finding", 5, group="kitchen_cabinets", needs="luxury low_maintenance"),
    _i("cabinet_hardware", "New cabinet hardware", "cabinets fixtures_hardware", "finding", 1, needs="low_maintenance"),
    _i("countertop_quartz_install", "Quartz countertops", "countertops", "finding", 10, needs="luxury"),
    _i("kitchen_backsplash", "Kitchen backsplash", "walls_ceilings countertops", "finding", 3, needs="luxury"),
    _i("kitchen_faucet_sink", "Kitchen faucet and sink", "fixtures_hardware", "per_finding", 1),
    _i("appliance_package_midrange", "Midrange appliance package", "appliances", "one", 7, needs="low_maintenance investor"),
    _i("bath_vanity_replace", "Replace bath vanity", "bath", "per_finding", 3, needs="low_maintenance luxury"),
    _i("bath_regrout_recaulk", "Regrout and recaulk", "bath cleaning", "per_finding", 1, needs="low_maintenance investor"),
    _i("bath_fixtures_update", "Update bath fixtures", "bath fixtures_hardware", "per_finding", 1),
    _i("flooring_lvp", "Luxury vinyl plank flooring", "flooring", "finding", 5, group="flooring", needs="more_space low_maintenance investor"),
    _i("flooring_carpet", "New carpet", "flooring", "finding", 3, group="flooring"),
    _i("flooring_hardwood_refinish", "Refinish hardwood floors", "flooring", "finding", 4, group="flooring", needs="luxury"),
    _i("light_fixture_replace", "Replace light fixtures", "lighting", "per_finding", 2),
    _i("recessed_lighting", "Recessed lighting", "lighting", "finding", 4, needs="work_from_home luxury"),
    _i("closet_system_walkin", "Walk-in closet system", "storage", "per_finding", 2, needs="more_space luxury"),
    _i("closet_system_reachin", "Reach-in closet system", "storage", "per_finding", 1, needs="more_space"),
    _i("garage_storage", "Garage storage", "storage", "one", 2, needs="more_space"),
    _i("built_in_shelving", "Built-in shelving", "storage", "finding", 4, needs="work_from_home more_space"),
    _i("home_office_setup", "Home office setup", "staging other", "one", 2, needs="work_from_home"),
    _i("landscaping_refresh", "Landscaping refresh", "landscaping curb_appeal", "finding", 4, needs="more_space low_maintenance"),
    _i("lawn_sod", "New lawn (sod)", "landscaping", "finding", 2, needs="more_space"),
    _i("front_door_replace_or_paint", "Front door (paint or replace)", "curb_appeal windows_doors", "one", 2),
    _i("exterior_lighting", "Exterior lighting", "curb_appeal exterior lighting", "per_finding", 1),
    _i("window_replace", "Replace windows", "windows_doors", "finding", 10, needs="low_maintenance"),
    _i("smart_thermostat", "Smart thermostat", "other", "one", 1),
    _i("smart_locks_doorbell", "Smart lock and doorbell", "other", "one", 1),
    _i("minor_repairs_handyman", "Handyman repairs", "repair walls_ceilings", "hours", 2),
    _i("staging_partial", "Partial staging", "staging decluttering", "months", 2, group="staging", always=True),
    _i("staging_full", "Full staging", "staging decluttering", "months", 3, group="staging", always=True),
    _i("professional_cleaning", "Professional cleaning", "cleaning decluttering", "one", 1, always=True),
    _i("pressure_washing", "Pressure washing", "exterior curb_appeal cleaning", "one", 1),
)

BY_KEY = {i.key: i for i in ITEMS}
# Items other items can require (the optimizer enumerates every combination of these).
PREREQUISITES = frozenset(k for i in ITEMS for k in i.requires)
HOURS_PER_REPAIR = 3  # handyman hours per repair finding when none is given
STAGING_MONTHS = 2  # listing period to stage for when no time is given
