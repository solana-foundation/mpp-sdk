"""Test that the server returns HTML payment pages for browsers."""
from __future__ import annotations

import httpx


def test_browser_gets_html(client: httpx.Client) -> None:
    resp = client.get("/fortune", headers={"Accept": "text/html"})
    assert resp.status_code == 402
    assert "text/html" in resp.headers.get("content-type", "")


def test_html_contains_root_div(client: httpx.Client) -> None:
    resp = client.get("/fortune", headers={"Accept": "text/html"})
    assert 'id="root"' in resp.text


def test_html_contains_data_element(client: httpx.Client) -> None:
    resp = client.get("/fortune", headers={"Accept": "text/html"})
    # Either __MPPX_DATA__ (mppx template) or __MPP_DATA__ (standalone)
    assert "__MPP_DATA__" in resp.text or "__MPPX_DATA__" in resp.text


def test_html_contains_script(client: httpx.Client) -> None:
    resp = client.get("/fortune", headers={"Accept": "text/html"})
    assert "<script" in resp.text


def test_html_has_www_authenticate(client: httpx.Client) -> None:
    resp = client.get("/fortune", headers={"Accept": "text/html"})
    assert "www-authenticate" in resp.headers


def test_service_worker_returns_javascript(client: httpx.Client) -> None:
    # Try both param names (mppx and standalone)
    resp = client.get("/fortune?__mppx_worker=1")
    if resp.status_code != 200:
        resp = client.get("/fortune?__mpp_worker=1")
    assert resp.status_code == 200
    assert "javascript" in resp.headers.get("content-type", "")
    assert "addEventListener" in resp.text
