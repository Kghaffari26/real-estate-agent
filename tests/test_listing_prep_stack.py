"""The P2 worker end to end on the real local Supabase stack (the `desk-db` workflow sets
DESK_TEST_API_URL, DESK_TEST_ANON_KEY and DESK_TEST_SERVICE_KEY after `supabase start`;
those are the local stack's well-known defaults, not secrets). Skipped elsewhere.

An agent signs in, adds a property with confirmed facts, a 2026-10b consent and three
photos (a clean kitchen, a living room the fake model says has people in it, and a bath
photo uploaded with GPS data by going around the Desk), and requests an analysis. The
worker then runs against the stack's real PostgREST, Storage and triggers with a fake
model client. Then the seller revokes consent, and a manager deletes the photos.

The test drives the stack with httpx directly (it plays the browser); the worker itself
goes through agents_core.http like everything else.
"""

from __future__ import annotations

import io
import json
import os
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from agents_core.http import Http
from PIL import Image

from agents.listing_prep import insights, places
from agents.listing_prep.backend import BUCKET, SupabaseBackend
from agents.listing_prep.worker import run
from tests.test_listing_prep import finding, jpeg, llm_with
from tests.test_listing_prep_context import REGION

URL = os.environ.get("DESK_TEST_API_URL", "")
ANON = os.environ.get("DESK_TEST_ANON_KEY", "")
SERVICE = os.environ.get("DESK_TEST_SERVICE_KEY", "")

if os.environ.get("DESK_REQUIRE_STACK") and not (URL and ANON and SERVICE):
    raise RuntimeError("DESK_TEST_API_URL, DESK_TEST_ANON_KEY and DESK_TEST_SERVICE_KEY are required here")
pytestmark = pytest.mark.skipif(not (URL and ANON and SERVICE), reason="needs the local Supabase stack (desk-db)")


def service_headers() -> dict[str, str]:
    return {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"}


class Agent:
    """A signed-in Desk user, as the browser would be."""

    def __init__(self, c: httpx.Client) -> None:
        self.c = c
        email = f"agent-{uuid.uuid4().hex[:10]}@example.com"
        password = f"pw-{uuid.uuid4().hex}"
        r = c.post(f"{URL}/auth/v1/admin/users", headers=service_headers(), json={"email": email, "password": password, "email_confirm": True})
        r.raise_for_status()
        self.id = r.json()["id"]
        token = c.post(f"{URL}/auth/v1/token", params={"grant_type": "password"}, headers={"apikey": ANON}, json={"email": email, "password": password})
        token.raise_for_status()
        self.h = {"apikey": ANON, "Authorization": f"Bearer {token.json()['access_token']}"}

    def rpc(self, name: str, args: dict[str, Any]) -> Any:
        r = self.c.post(f"{URL}/rest/v1/rpc/{name}", headers=self.h, json=args)
        r.raise_for_status()
        return r.json() if r.content else None

    def insert(self, table: str, row: dict[str, Any]) -> dict[str, Any]:
        r = self.c.post(f"{URL}/rest/v1/{table}", headers={**self.h, "Prefer": "return=representation"}, json=row)
        r.raise_for_status()
        return r.json()[0]

    def select(self, table: str, **filters: str) -> list[dict[str, Any]]:
        r = self.c.get(f"{URL}/rest/v1/{table}", headers=self.h, params={"select": "*", **filters})
        r.raise_for_status()
        return r.json()

    def upload(self, path: str, data: bytes) -> None:
        r = self.c.post(f"{URL}/storage/v1/object/{BUCKET}/{path}", headers={**self.h, "Content-Type": "image/jpeg"}, content=data)
        r.raise_for_status()


def stored(c: httpx.Client, path: str) -> bool:
    return c.get(f"{URL}/storage/v1/object/authenticated/{BUCKET}/{path}", headers=service_headers()).status_code == 200


def noisy_jpeg() -> bytes:
    img = Image.effect_noise((800, 600), 40).convert("RGB")
    out = io.BytesIO()
    img.save(out, format="JPEG")
    return out.getvalue()


def test_worker_on_the_real_stack(tmp_path):
    with httpx.Client(timeout=30) as c:
        agent = Agent(c)
        team = agent.rpc("create_team", {"team_name": "Coastline Realty"})
        prop = agent.insert("properties", {"team_id": team, "created_by": agent.id, "address": "1 Civic Center Plaza, Irvine, CA", "zip": "92606",
                                            "place_id": "0636770", "lat": 33.6875, "lon": -117.8263,
                                            "facts": {"beds": 3, "baths": 2.5, "sqft": 1850, "year_built": 1978, "property_type": "single_family"}})["id"]
        agent.rpc("confirm_facts", {"property": prop})
        agent.insert("cost_book", {"team_id": team, "item": "cabinet_refinish", "category": "kitchen", "unit": "linear_ft", "low_usd": 90, "high_usd": 160, "updated_by": agent.id})
        consent = agent.insert("seller_consents", {"property_id": prop, "seller_name": "Pat Seller", "method": "signed_form", "consent_version": "2026-10b", "recorded_by": agent.id})["id"]
        paths = {}
        for room, data in [("kitchen", noisy_jpeg()), ("living", jpeg()), ("bath", jpeg(gps=True))]:
            path = f"{team}/{prop}/{uuid.uuid4()}.jpg"
            agent.upload(path, data)
            agent.insert("photos", {"property_id": prop, "room": room, "storage_path": path, "bytes": len(data), "mime": "image/jpeg", "uploaded_by": agent.id})
            paths[room] = path
        job = agent.insert("vision_jobs", {"property_id": prop, "requested_by": agent.id})["id"]

        answers = [
            {"people_visible": False, "usable": True, "findings": [finding(), finding(issue="Family photos crowd the hallway", category="decluttering")]},
            {"people_visible": True, "usable": True, "findings": [finding()]},
        ]
        llm, client, tracker = llm_with(answers, tmp_path)
        from agents_core.costs import SpendScope

        summary = run(SupabaseBackend(Http(), URL, SERVICE), llm, scope_factory=lambda usd, label: SpendScope(tracker, usd, label=label))

        [report] = [j for j in summary["jobs"] if j["id"] == job]
        assert (report["status"], report["analyzed"], report["skipped"], report["rejected"], report["findings"], report["dropped_fair_housing"]) == ("done", 1, 1, 1, 1, 1)
        assert len(client.requests) == 2  # the GPS photo never reached the model
        assert agent.select("vision_jobs", id=f"eq.{job}")[0]["status"] == "done"
        outcomes = {r["outcome"] for r in agent.select("photo_results")}
        assert outcomes == {"analyzed", "skipped_people", "rejected_metadata"}
        [f] = agent.select("findings", property_id=f"eq.{prop}")
        assert (f["issue"], f["fix_item"], f["status"]) == ("Cabinet doors are worn at the edges", "cabinet_refinish", "proposed")
        assert not stored(c, paths["bath"]) and stored(c, paths["kitchen"])

        # P3 insights through the real PostgREST (outside sources from fixtures).
        fix = Path(__file__).parent / "fixtures" / "listing_prep"
        with respx.mock(assert_all_called=False) as mock:
            mock.route(host="127.0.0.1").pass_through()
            mock.get(insights.REGION_DATA_URL).mock(return_value=httpx.Response(200, json=REGION))
            mock.get(places.CDE_URL).mock(return_value=httpx.Response(200, content=(fix / "cde_schools_sample.tsv").read_bytes()))
            mock.get(places.OVERPASS_URL).mock(return_value=httpx.Response(200, json=json.loads((fix / "overpass_irvine_800m.json").read_text())))
            done = insights.insights_pass(SupabaseBackend(Http(cache_dir=tmp_path / "http"), URL, SERVICE), Http(cache_dir=tmp_path / "http2"))
        assert done >= 1
        [ins] = agent.select("property_insights", property_id=f"eq.{prop}")
        assert ins["valuation"]["method"] == "zip_ppsf" and ins["valuation"]["confidence"] == "low"
        assert ins["schools"] and ins["amenities"]
        assert c.post(f"{URL}/rest/v1/property_insights", headers=agent.h, json={"property_id": prop}).status_code >= 400

        # The agent reviews; then the seller revokes.
        r = c.patch(f"{URL}/rest/v1/findings", headers=agent.h, params={"id": f"eq.{f['id']}"}, json={"status": "confirmed"})
        r.raise_for_status()
        r = c.patch(f"{URL}/rest/v1/seller_consents", headers=agent.h, params={"id": f"eq.{consent}"}, json={"revoked_at": "2026-10-02T12:00:00Z"})
        r.raise_for_status()
        assert agent.select("findings", property_id=f"eq.{prop}")[0]["status"] == "withdrawn"
        assert agent.select("photos", property_id=f"eq.{prop}") == []  # hidden
        assert agent.select("photo_results") == []
        signed = c.post(f"{URL}/storage/v1/object/sign/{BUCKET}/{paths['kitchen']}", headers=agent.h, json={"expiresIn": 60})
        assert signed.status_code >= 400  # no URL for a hidden photo
        # No new job without consent.
        assert c.post(f"{URL}/rest/v1/vision_jobs", headers=agent.h, json={"property_id": prop, "requested_by": agent.id}).status_code >= 400

        # The manager deletes the photos; the worker deletes the files.
        assert agent.rpc("purge_property_photos", {"property": prop}) == 3
        assert stored(c, paths["kitchen"])
        summary = run(SupabaseBackend(Http(), URL, SERVICE), None, janitor_only=True)
        assert summary["janitor"]["files_deleted"] >= 3
        assert not stored(c, paths["kitchen"]) and not stored(c, paths["living"])
        left = c.get(f"{URL}/rest/v1/storage_deletions", headers=service_headers(), params={"select": "id"}).json()
        assert left == []
