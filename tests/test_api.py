import os, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "api"))
os.environ.pop("GEMINI_API_KEY", None)  # the API must start and serve tariff/twin without a Gemini key
from fastapi.testclient import TestClient
import main

client = TestClient(main.app)


def test_health_without_key():
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["ocr_configured"] is False


def test_tariff_endpoint_matches_engine():
    assert client.get("/tariff", params={"units": 412}).json()["total_tk"] == 3684.58


def test_tariff_rejects_negative_units():
    assert client.get("/tariff", params={"units": -5}).status_code == 422


def test_nameplate_endpoint():
    r = client.post("/twin/nameplate", json=[{"type": "ac", "watts": 1500, "qty": 1, "hours": 6}])
    assert r.json()["kwh_per_day"] == 9.0


def test_ocr_rejects_non_images():
    r = client.post("/ocr/meter", files={"photo": ("x.txt", b"x", "text/plain")})
    assert r.status_code == 415


def test_ocr_without_key_is_503_not_a_guess():
    r = client.post("/ocr/meter", files={"photo": ("m.jpg", b"x", "image/jpeg")})
    assert r.status_code == 503
