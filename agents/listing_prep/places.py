"""What's near a property: public schools and everyday amenities (Listing Prep P3,
SPEC_LISTING_PREP.md §5.1). Distances and counts only, computed here.

* **Schools**: the California Department of Education's public school directory (a
  ~9 MB tab-separated file, downloaded with a conditional GET and cached). Kept: the
  school's code, name, type, grades and position. The directory also lists
  administrators by name; those columns are never read. No ratings yet: the CAASPP
  results are a separate, larger dataset (a later step). Attribution: California
  Department of Education.
* **Amenities**: OpenStreetMap through the Overpass API, cached for a week: groceries,
  parks, transit stops, cafés and restaurants within a walk. Attribution:
  © OpenStreetMap contributors (ODbL).
"""

from __future__ import annotations

import csv
import io
import math
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from agents_core import settings
from agents_core.http import Http, HttpError

CDE_URL = "https://www.cde.ca.gov/schooldirectory/report?rid=dl1&tp=txt"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
WALK_METERS = 1600  # about a 20-minute walk
KEEP = ("CDSCode", "School", "SOCType", "GSserved", "Charter", "Latitude", "Longitude", "City", "County", "StatusType")


def _meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


# ---------- schools ----------


@dataclass(frozen=True)
class School:
    code: str
    name: str
    level: str  # "elementary" | "middle" | "high" | "k12"
    grades: str
    charter: bool
    lat: float
    lon: float


# Regular public schools only: continuation, alternative, adult, juvenile court, special
# education, opportunity and preschool programs don't serve a neighborhood.
LEVELS = {
    "Elementary Schools (Public)": "elementary",
    "Elementary Schools in 1 School District (Public)": "elementary",
    "Intermediate/Middle Schools (Public)": "middle",
    "Junior High Schools (Public)": "middle",
    "High Schools (Public)": "high",
    "High Schools In 1 School District (Public)": "high",
    "K-12 Schools (Public)": "k12",
}


def _level(soc: str, grades: str) -> str | None:  # noqa: ARG001 - grades kept for the record
    return LEVELS.get(soc.strip())


def parse_directory(text: str, county: str = "Orange") -> list[School]:
    """Active public schools in `county` with a position and a recognisable level."""
    out = []
    for row in csv.DictReader(io.StringIO(text), delimiter="\t"):
        row = {k: row.get(k, "") for k in KEEP}  # nothing else is read (the file names administrators)
        if row["County"] != county or row["StatusType"] != "Active":
            continue
        try:
            lat, lon = float(row["Latitude"]), float(row["Longitude"])
        except ValueError:
            continue
        level = _level(row["SOCType"], row["GSserved"])
        if level is None or row["School"] in ("", "No Data"):
            continue
        out.append(School(row["CDSCode"], row["School"], level, row["GSserved"], row["Charter"] == "Y", lat, lon))
    return out


def load_schools(http: Http, cache_dir: Path | None = None) -> list[School]:
    path = (cache_dir or settings.data_dir() / "cache") / "listing_prep" / "cde_schools.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    http.download(CDE_URL, path)
    return parse_directory(path.read_text(encoding="latin-1"))


@dataclass(frozen=True)
class NearbySchool:
    name: str
    level: str
    grades: str
    charter: bool
    miles: float


def nearest_schools(lat: float, lon: float, schools: Iterable[School], per_level: int = 2) -> list[NearbySchool]:
    """The closest `per_level` non-charter schools of each level (charters don't serve an
    attendance area, so they're listed only when nothing else is near), by straight-line
    distance. Attendance boundaries aren't public in one file, so this says "nearest",
    never "assigned"."""
    ranked = sorted(((s, _meters(lat, lon, s.lat, s.lon)) for s in schools), key=lambda x: x[1])
    out: list[NearbySchool] = []
    for level in ("elementary", "middle", "high"):
        picks = [x for x in ranked if x[0].level in (level, "k12") and not x[0].charter][:per_level] or [x for x in ranked if x[0].level == level][:per_level]
        out += [NearbySchool(s.name, level, s.grades, s.charter, round(m / 1609.344, 2)) for s, m in picks]
    return out


# ---------- amenities ----------

AMENITIES = {
    "grocery": '["shop"~"^(supermarket|greengrocer|grocery)$"]',
    "park": '["leisure"="park"]',
    "transit": '["highway"="bus_stop"]',
    "rail": '["railway"="station"]',
    "cafe_restaurant": '["amenity"~"^(cafe|restaurant)$"]',
}


def overpass_query(lat: float, lon: float, radius: int = WALK_METERS) -> str:
    parts = "".join(f"nwr(around:{radius},{lat:.6f},{lon:.6f}){tag};" for tag in AMENITIES.values())
    return f"[out:json][timeout:25];({parts});out center tags;"


@dataclass(frozen=True)
class AmenityCount:
    kind: str
    count: int
    nearest_miles: float | None


def summarize_amenities(lat: float, lon: float, elements: list[dict]) -> list[AmenityCount]:
    found: dict[str, list[float]] = {k: [] for k in AMENITIES}
    for e in elements:
        tags = e.get("tags") or {}
        pos = (e.get("lat"), e.get("lon")) if "lat" in e else ((e.get("center") or {}).get("lat"), (e.get("center") or {}).get("lon"))
        if pos[0] is None:
            continue
        d = _meters(lat, lon, float(pos[0]), float(pos[1]))
        if tags.get("shop") in {"supermarket", "greengrocer", "grocery"}:
            found["grocery"].append(d)
        if tags.get("leisure") == "park":
            found["park"].append(d)
        if tags.get("highway") == "bus_stop":
            found["transit"].append(d)
        if tags.get("railway") == "station":
            found["rail"].append(d)
        if tags.get("amenity") in {"cafe", "restaurant"}:
            found["cafe_restaurant"].append(d)
    return [AmenityCount(k, len(v), round(min(v) / 1609.344, 2) if v else None) for k, v in found.items()]


def amenities(http: Http, lat: float, lon: float) -> list[AmenityCount] | None:
    try:
        data = http.get_json(OVERPASS_URL, params={"data": overpass_query(lat, lon)}, headers={"Accept": "application/json"}, ttl_seconds=7 * 86400)
    except (HttpError, ValueError):
        return None
    return summarize_amenities(lat, lon, data.get("elements", []) if isinstance(data, dict) else [])
