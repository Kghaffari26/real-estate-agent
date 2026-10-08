"""What's near a property: public schools and everyday amenities (Listing Prep P3,
SPEC_LISTING_PREP.md §5.1). Distances and counts only, computed here.

* **Schools**: the California Department of Education's public school directory (a
  ~9 MB tab-separated file, downloaded with a conditional GET and cached). Kept: the
  school's code, name, type, grades and position. The directory also lists
  administrators by name; those columns are never read. **No ratings, ever** (owner
  review): each school links to its page on the official California School Dashboard
  instead, so the Desk never republishes or summarizes school performance.
  Attribution: California Department of Education.
* **Amenities**: OpenStreetMap through the Overpass API: groceries, parks, transit
  stops, cafés and restaurants within a walk. A public, volunteer-run service, so the
  worker is a polite client: an identifying User-Agent, at most one request every
  2 seconds and 400 a day (an `agents_core` host policy), up to 3 attempts with backoff
  when it's busy (504/429), and a per-property cache in the database (a property's
  answer is reused for 30 days; `insights.py`). A failure returns None, never raises.
  Attribution: © OpenStreetMap contributors (ODbL).
"""

from __future__ import annotations

import csv
import io
import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from agents_core import settings
from agents_core.http import HostPolicy, Http, HttpError

CDE_URL = "https://www.cde.ca.gov/schooldirectory/report?rid=dl1&tp=txt"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_HOST = "overpass-api.de"
OVERPASS_POLICY = HostPolicy(min_interval_seconds=2.0, daily_budget=400, max_attempts=3)
# Overpass asks clients to identify themselves.
OVERPASS_USER_AGENT = "MetroPulseDesk/0.1 (listing-prep worker; +https://github.com/Kghaffari26/real-estate-agent)"
DASHBOARD_URL = "https://www.caschooldashboard.org/reports/{cds}/{year}"
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
    cds: str = ""
    dashboard_url: str = ""  # the school's official California School Dashboard report


def dashboard_url(cds: str, today: date | None = None) -> str:
    """The school's report on the official California School Dashboard. Each year's
    Dashboard is released in December, so the latest complete one is last year's."""
    return DASHBOARD_URL.format(cds=cds, year=(today or date.today()).year - 1)


def nearest_schools(lat: float, lon: float, schools: Iterable[School], per_level: int = 2) -> list[NearbySchool]:
    """The closest `per_level` non-charter schools of each level (charters don't serve an
    attendance area, so they're listed only when nothing else is near), by straight-line
    distance. Attendance boundaries aren't public in one file, so this says "nearest",
    never "assigned"."""
    ranked = sorted(((s, _meters(lat, lon, s.lat, s.lon)) for s in schools), key=lambda x: x[1])
    out: list[NearbySchool] = []
    for level in ("elementary", "middle", "high"):
        picks = [x for x in ranked if x[0].level in (level, "k12") and not x[0].charter][:per_level] or [x for x in ranked if x[0].level == level][:per_level]
        out += [NearbySchool(s.name, level, s.grades, s.charter, round(m / 1609.344, 2), s.code, dashboard_url(s.code)) for s, m in picks]
    return out


# ---------- amenities ----------

AMENITIES = {
    "grocery": '["shop"~"^(supermarket|greengrocer|grocery)$"]',
    "park": '["leisure"="park"]',
    "transit": '["highway"="bus_stop"]',
    "rail": '["railway"="station"]',
    "cafe_restaurant": '["amenity"~"^(cafe|restaurant)$"]',
}


def point_key(lat: float, lon: float) -> str:
    """The cache key for a property's amenities: its position to 5 decimals (about 1 m)."""
    return f"{lat:.5f},{lon:.5f}"


def overpass_query(lat: float, lon: float, radius: int = WALK_METERS) -> str:
    parts = "".join(f"nwr(around:{radius},{lat:.5f},{lon:.5f}){tag};" for tag in AMENITIES.values())
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
    """One Overpass request under the polite policy. None when the service is busy or
    down after its retries, over the daily budget, or answers with an error remark
    (Overpass reports timeouts inside a 200): the caller keeps its previous answer."""
    http.set_policy(OVERPASS_HOST, OVERPASS_POLICY)
    try:
        res = http.request(
            "GET",
            OVERPASS_URL,
            params={"data": overpass_query(lat, lon)},
            headers={"Accept": "application/json", "User-Agent": OVERPASS_USER_AGENT},
            ttl_seconds=0,  # cached per property in the database instead
        )
        data = res.json()
    except (HttpError, ValueError):
        return None
    if not isinstance(data, dict) or "elements" not in data or "runtime error" in str(data.get("remark", "")):
        return None
    return summarize_amenities(lat, lon, data["elements"])
