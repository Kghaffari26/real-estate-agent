"""Per-property insights (Listing Prep P3): the value range, buyer demand by need, nearby
schools and amenities, computed by the worker once a property's facts are confirmed and
stored in `property_insights` for the Desk to show. Every number is computed here.

`build_insights` is pure (it takes the region data, findings and fetched context);
`insights_pass` fetches what it needs through `agents_core.http` and writes the rows.
Inputs that aren't available (no $/sq ft for the ZIP, no Census key, no map pin, a
source down) leave that part empty, with a note saying why. They never fail the pass.
"""

from __future__ import annotations

import logging
import os
from dataclasses import asdict
from typing import Any

from agents_core.http import Http, HttpError

from agents.listing_prep import demand, places, valuation

log = logging.getLogger("listing_prep.insights")

REGION_DATA_URL = os.environ.get("DESK_REGION_DATA_URL", "https://kghaffari26.github.io/real-estate-agent/data/regions/orange-county.json")
PER_RUN = 20


def _latest(area: dict[str, Any] | None, key: str) -> float | None:
    v = ((area or {}).get("latest") or {}).get(key) or {}
    return v.get("value") if isinstance(v, dict) else None


def area_for(region: dict[str, Any] | None, zip_code: str | None, place_id: str | None) -> tuple[dict | None, dict | None]:
    """The property's ZIP and city records in the published region data."""
    if not region:
        return None, None
    z = next((a for a in region.get("zips", []) if a.get("id") == zip_code), None) if zip_code else None
    cities = region.get("cities", [])
    c = next((a for a in cities if a.get("id") == place_id), None) if place_id else None
    if c is None and z and z.get("city"):
        c = next((a for a in cities if a.get("name") == z["city"]), None)
    return z, c


def build_insights(
    prop: dict[str, Any],
    *,
    region: dict[str, Any] | None,
    findings: list[tuple[int, str]],
    acs: tuple[demand.AreaStats, demand.AreaStats] | None,
    schools: list[places.NearbySchool] | None,
    amenities: list[places.AmenityCount] | None,
) -> dict[str, Any]:
    facts = prop.get("facts") or {}
    notes: list[str] = []
    sources: list[str] = []
    z, c = area_for(region, prop.get("zip"), prop.get("place_id"))

    value = None
    if z is None and c is None:
        notes.append("This ZIP isn’t in the published market data (Orange County for now), so no value range yet.")
    elif not facts.get("sqft"):
        notes.append("The living area isn’t confirmed, so no value range yet.")
    else:
        value = valuation.zip_ppsf_value(
            sqft=int(facts["sqft"]),
            zip_ppsf=_latest(z, "median_ppsf"),
            zip_median_price=_latest(z, "median_sale_price"),
            zip_low_sample=bool((z or {}).get("low_sample")),
            city_ppsf=_latest(c, "median_ppsf"),
            condition=valuation.condition_score(findings),
        )
        if value is None:
            notes.append("The market data has no $/sq ft for this ZIP or its city yet, so no value range yet.")
        else:
            sources.append(f"Redfin ZIP and city medians, data through {region.get('data_through') if region else 'n/a'}")

    segs = None
    if acs is None:
        notes.append("Buyer demand needs the Census key (CENSUS_API_KEY) or the Census service was unavailable.")
    else:
        segs = demand.segments(facts, value.mid if value else _latest(z, "median_sale_price"), *acs)
        sources.append(f"U.S. Census Bureau, American Community Survey {demand.ACS_YEAR} 5-year estimates")

    if prop.get("lat") is None:
        notes.append("No map pin (the address wasn’t matched), so schools and amenities aren’t listed.")
    else:
        if schools is not None:
            sources.append("California Department of Education, public school directory (nearest by distance; not attendance boundaries)")
        else:
            notes.append("The school directory was unavailable.")
        if amenities is not None:
            sources.append("© OpenStreetMap contributors (ODbL)")
        else:
            notes.append("The amenities service was unavailable.")

    return {
        "property_id": prop["id"],
        "valuation": asdict(value) if value else None,
        "segments": [asdict(s) for s in segs] if segs is not None else None,
        "schools": [asdict(s) for s in schools] if schools is not None and prop.get("lat") is not None else None,
        "amenities": [asdict(a) for a in amenities] if amenities is not None and prop.get("lat") is not None else None,
        "sources": sources,
        "notes": notes,
    }


def insights_pass(backend: Any, http: Http) -> int:
    """Compute and store insights for the properties that need them. Returns how many."""
    todo = backend.needing_insights(PER_RUN)
    if not todo:
        return 0
    try:
        region = http.get_json(REGION_DATA_URL, ttl_seconds=3600)
    except (HttpError, ValueError):
        region = None
    school_list: list[places.School] | None = None
    if any(p.get("lat") is not None for p in todo):
        try:
            school_list = places.load_schools(http)
        except (HttpError, OSError, ValueError):
            school_list = None
    done = 0
    for prop in todo:
        lat, lon = prop.get("lat"), prop.get("lon")
        row = build_insights(
            prop,
            region=region,
            findings=backend.reviewed_findings(prop["id"]),
            acs=demand.fetch_acs(http, prop["zip"]) if prop.get("zip") else None,
            schools=places.nearest_schools(lat, lon, school_list) if (school_list is not None and lat is not None) else None,
            amenities=places.amenities(http, lat, lon) if lat is not None else None,
        )
        backend.upsert_insights(row)
        done += 1
    return done
