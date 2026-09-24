from __future__ import annotations

import httpx
import respx

from agents_core.http import HTTPClient


def test_download_conditional_get_304(tmp_path):
    url = "https://example.com/data.csv"
    dest = tmp_path / "data.csv"

    with respx.mock:
        respx.get(url).mock(
            return_value=httpx.Response(200, content=b"hello", headers={"ETag": '"abc123"'})
        )
        with HTTPClient(cache_dir=tmp_path / "cache") as client:
            result = client.download(url, dest)
        assert result.modified is True
        assert result.etag == '"abc123"'
        assert dest.read_bytes() == b"hello"

    with respx.mock:
        respx.get(url).mock(return_value=httpx.Response(304))
        with HTTPClient(cache_dir=tmp_path / "cache") as client:
            result2 = client.download(url, dest)
        assert result2.modified is False
        assert dest.read_bytes() == b"hello"  # untouched by the 304


def test_download_force_ignores_prior_etag(tmp_path):
    url = "https://example.com/data.csv"
    dest = tmp_path / "data.csv"

    with respx.mock:
        respx.get(url).mock(
            return_value=httpx.Response(200, content=b"v1", headers={"ETag": '"a"'})
        )
        with HTTPClient(cache_dir=tmp_path / "cache") as client:
            client.download(url, dest)

    with respx.mock:
        respx.get(url).mock(
            return_value=httpx.Response(200, content=b"v2", headers={"ETag": '"b"'})
        )
        with HTTPClient(cache_dir=tmp_path / "cache") as client:
            result = client.download(url, dest, force=True)
        assert result.modified is True
        assert dest.read_bytes() == b"v2"


def test_get_json_cache_hit_avoids_second_network_call(tmp_path):
    url = "https://example.com/api"
    calls = {"n": 0}

    def responder(request):
        calls["n"] += 1
        return httpx.Response(200, json={"value": 1})

    with respx.mock:
        respx.get(url).mock(side_effect=responder)
        with HTTPClient(cache_dir=tmp_path / "cache") as client:
            first = client.get_json(url, ttl_seconds=3600)
            second = client.get_json(url, ttl_seconds=3600)

    assert first == {"value": 1}
    assert second == {"value": 1}
    assert calls["n"] == 1


def test_get_json_cache_expires_after_ttl(tmp_path):
    url = "https://example.com/api"
    calls = {"n": 0}

    def responder(request):
        calls["n"] += 1
        return httpx.Response(200, json={"value": calls["n"]})

    with respx.mock:
        respx.get(url).mock(side_effect=responder)
        with HTTPClient(cache_dir=tmp_path / "cache") as client:
            first = client.get_json(url, ttl_seconds=0)
            second = client.get_json(url, ttl_seconds=0)

    assert first == {"value": 1}
    assert second == {"value": 2}
    assert calls["n"] == 2


def test_get_bytes(tmp_path):
    url = "https://example.com/file.bin"
    with respx.mock:
        respx.get(url).mock(return_value=httpx.Response(200, content=b"\x00\x01\x02"))
        with HTTPClient(cache_dir=tmp_path / "cache") as client:
            data = client.get_bytes(url)
    assert data == b"\x00\x01\x02"
