"""Conditional-GET downloads of large source files, on top of `agents_core.http.Http`.

`Http`'s own on-disk cache is a TTL cache keyed by URL (it stores bodies
base64-encoded in JSON), which suits small API responses (FRED, ACS) but not
Redfin's ~110MB tracker. For large files this module instead sends
`If-None-Match`/`If-Modified-Since` from the last successful download (kept
in a `.meta.json` sidecar next to the file) with Http's cache disabled
(`ttl_seconds=0`). `Http` raises `HttpError(status=304)` for a 304 (it's not
2xx and not retryable), which is translated here into `modified=False` so the
caller can skip reprocessing entirely.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from agents_core.http import Http, HttpError


@dataclass
class DownloadResult:
    path: Path
    modified: bool
    etag: str | None
    last_modified: str | None
    status_code: int


def _meta_path(dest: Path) -> Path:
    return dest.with_name(dest.name + ".meta.json")


def download(http: Http, url: str, dest: Path | str, *, force: bool = False) -> DownloadResult:
    """Conditional GET `url` to `dest`. A 304 leaves `dest` untouched."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    meta_path = _meta_path(dest)

    prior: dict[str, Any] = {}
    headers: dict[str, str] = {}
    if not force and dest.exists() and meta_path.exists():
        try:
            prior = json.loads(meta_path.read_text())
        except json.JSONDecodeError:
            prior = {}
        if prior.get("etag"):
            headers["If-None-Match"] = prior["etag"]
        if prior.get("last_modified"):
            headers["If-Modified-Since"] = prior["last_modified"]

    try:
        response = http.get(url, headers=headers or None, ttl_seconds=0)
    except HttpError as exc:
        if exc.status == 304 and dest.exists():
            return DownloadResult(
                path=dest,
                modified=False,
                etag=prior.get("etag"),
                last_modified=prior.get("last_modified"),
                status_code=304,
            )
        raise

    tmp = dest.with_name(dest.name + ".tmp")
    tmp.write_bytes(response.content)
    tmp.replace(dest)
    etag = response.headers.get("etag")
    last_modified = response.headers.get("last-modified")
    meta_path.write_text(json.dumps({"etag": etag, "last_modified": last_modified, "url": url}))
    return DownloadResult(
        path=dest,
        modified=True,
        etag=etag,
        last_modified=last_modified,
        status_code=response.status,
    )
