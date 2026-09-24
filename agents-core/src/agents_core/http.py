"""Shared HTTP client: retries, basic rate limiting, and an on-disk cache.

Two caching modes are supported, matching the two shapes of request the
agents make:

- `get_json` / `get_text`: small, frequently-refetched responses (FRED
  series, Census ACS). Cached by URL+params with a TTL; a cache hit makes
  no network call at all.
- `download`: large files (Redfin's metro tracker, Zillow's ZHVI/ZORI
  CSVs) that publish an ETag/Last-Modified and should only be re-downloaded
  when the server says they changed. Always issues a conditional GET and
  reports whether the body actually changed.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

DEFAULT_CACHE_DIR = Path("data/cache/http")
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_RETRIES = 3
DEFAULT_MIN_INTERVAL = 0.2  # seconds between requests to the same host


def _cache_key(url: str, params: dict[str, Any] | None) -> str:
    raw = url + "?" + json.dumps(params or {}, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()


@dataclass
class DownloadResult:
    path: Path
    modified: bool
    etag: str | None
    last_modified: str | None
    status_code: int


class HTTPClient:
    """A small httpx wrapper. One instance per agent run."""

    def __init__(
        self,
        cache_dir: Path | str = DEFAULT_CACHE_DIR,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        min_interval: float = DEFAULT_MIN_INTERVAL,
        user_agent: str = "agents-hub-real-estate/1.0",
    ) -> None:
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.max_retries = max_retries
        self.min_interval = min_interval
        self._last_request_at: dict[str, float] = {}
        self._client = httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": user_agent},
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> HTTPClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # -- internals --------------------------------------------------

    def _throttle(self, url: str) -> None:
        host = httpx.URL(url).host
        last = self._last_request_at.get(host)
        if last is not None:
            wait = self.min_interval - (time.monotonic() - last)
            if wait > 0:
                time.sleep(wait)
        self._last_request_at[host] = time.monotonic()

    def _request_with_retries(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        last_exc: Exception | None = None
        response: httpx.Response | None = None
        for attempt in range(self.max_retries):
            self._throttle(url)
            try:
                response = self._client.request(method, url, **kwargs)
            except httpx.TransportError as exc:
                last_exc = exc
                response = None
            else:
                if response.status_code >= 500:
                    last_exc = httpx.HTTPStatusError(
                        f"{response.status_code} from {url}",
                        request=response.request,
                        response=response,
                    )
                else:
                    return response
            if attempt < self.max_retries - 1:
                time.sleep(2**attempt)
        if response is not None:
            return response
        assert last_exc is not None
        raise last_exc

    # -- small cached responses --------------------------------------

    def get_json(
        self,
        url: str,
        params: dict[str, Any] | None = None,
        ttl_seconds: int = 3600,
        headers: dict[str, str] | None = None,
    ) -> Any:
        cached = self._read_cache(url, params, ttl_seconds)
        if cached is not None:
            return json.loads(cached)
        response = self._request_with_retries("GET", url, params=params, headers=headers)
        response.raise_for_status()
        self._write_cache(url, params, response.text)
        return response.json()

    def get_text(
        self,
        url: str,
        params: dict[str, Any] | None = None,
        ttl_seconds: int = 3600,
        headers: dict[str, str] | None = None,
    ) -> str:
        cached = self._read_cache(url, params, ttl_seconds)
        if cached is not None:
            return cached
        response = self._request_with_retries("GET", url, params=params, headers=headers)
        response.raise_for_status()
        self._write_cache(url, params, response.text)
        return response.text

    def _cache_paths(self, url: str, params: dict[str, Any] | None) -> tuple[Path, Path]:
        key = _cache_key(url, params)
        return self.cache_dir / f"{key}.body", self.cache_dir / f"{key}.meta.json"

    def _read_cache(self, url: str, params: dict[str, Any] | None, ttl_seconds: int) -> str | None:
        body_path, meta_path = self._cache_paths(url, params)
        if not (body_path.exists() and meta_path.exists()):
            return None
        meta = json.loads(meta_path.read_text())
        if time.time() - meta["fetched_at"] > ttl_seconds:
            return None
        return body_path.read_text()

    def _write_cache(self, url: str, params: dict[str, Any] | None, body: str) -> None:
        body_path, meta_path = self._cache_paths(url, params)
        body_path.write_text(body)
        meta_path.write_text(json.dumps({"url": url, "params": params, "fetched_at": time.time()}))

    # -- conditional large-file downloads ----------------------------

    def download(self, url: str, dest_path: Path | str, force: bool = False) -> DownloadResult:
        """Conditional GET a (potentially large) file to `dest_path`.

        Sends `If-None-Match`/`If-Modified-Since` from the last successful
        download's response headers (tracked in a sidecar `.meta.json`
        next to `dest_path`). A 304 leaves `dest_path` untouched and
        reports `modified=False`, so the caller can skip reprocessing
        entirely.
        """
        dest_path = Path(dest_path)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path = dest_path.with_name(dest_path.name + ".meta.json")

        headers: dict[str, str] = {}
        prior: dict[str, Any] = {}
        if meta_path.exists() and not force:
            prior = json.loads(meta_path.read_text())
            if prior.get("etag"):
                headers["If-None-Match"] = prior["etag"]
            if prior.get("last_modified"):
                headers["If-Modified-Since"] = prior["last_modified"]

        with self._client.stream("GET", url, headers=headers) as response:
            if response.status_code == 304:
                return DownloadResult(
                    path=dest_path,
                    modified=False,
                    etag=prior.get("etag"),
                    last_modified=prior.get("last_modified"),
                    status_code=304,
                )
            response.raise_for_status()
            tmp_path = dest_path.with_name(dest_path.name + ".tmp")
            with open(tmp_path, "wb") as f:
                for chunk in response.iter_bytes():
                    f.write(chunk)
            tmp_path.replace(dest_path)
            etag = response.headers.get("ETag")
            last_modified = response.headers.get("Last-Modified")
            meta_path.write_text(json.dumps({"etag": etag, "last_modified": last_modified, "url": url}))
            return DownloadResult(
                path=dest_path,
                modified=True,
                etag=etag,
                last_modified=last_modified,
                status_code=response.status_code,
            )

    def head(self, url: str) -> httpx.Response:
        return self._request_with_retries("HEAD", url)

    def get_bytes(self, url: str, params: dict[str, Any] | None = None) -> bytes:
        """An uncached GET returning raw bytes, for small one-off binary
        downloads (e.g. a reference-data zip) that don't fit `get_json`/
        `get_text`'s text cache or `download`'s conditional-GET bookkeeping."""
        response = self._request_with_retries("GET", url, params=params)
        response.raise_for_status()
        return response.content
