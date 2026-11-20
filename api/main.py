"""Bill Bachao API (preliminary). Run: uvicorn main:app --reload --port 8000"""
import hashlib, json, os
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

from tariff import tariff_calc, marginal_rate
from twin import nameplate_kwh_per_day

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")  # use the current Flash model name from AI Studio
_client = None


def gemini():
    """Create the Gemini client on first use, so /health, /tariff and /twin work without a key."""
    global _client
    if _client is None:
        key = os.getenv("GEMINI_API_KEY")
        if not key:
            raise HTTPException(503, "Meter OCR is not configured: set GEMINI_API_KEY")
        _client = genai.Client(api_key=key)
    return _client

app = FastAPI(title="Bill Bachao API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["*"], allow_headers=["*"],
)


class MeterReading(BaseModel):
    kwh_cumulative: float | None = Field(None, description="Total kWh register, if visible")
    balance_tk: float | None = Field(None, description="Prepaid remaining balance in Tk, if visible")
    confidence: float = Field(..., ge=0, le=1)
    notes: str | None = None


OCR_PROMPT = (
    "You read Bangladeshi electricity meter displays (prepaid or postpaid). "
    "Return ONLY the numbers you can clearly see. If a value is not visible, return null. "
    "Never guess. confidence = how sure you are that the digits are exactly right (0 to 1)."
)


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "ocr_configured": bool(os.getenv("GEMINI_API_KEY"))}


@app.get("/tariff")
def tariff(units: float = Query(..., ge=0), sanctioned_kw: float = Query(0, ge=0), demand_rate: float = Query(0, ge=0)):
    b = tariff_calc(units, sanctioned_kw, demand_rate)
    return {**b.__dict__, "next_unit_rate": marginal_rate(units)}


@app.post("/ocr/meter", response_model=MeterReading)
async def ocr_meter(photo: UploadFile = File(...)):
    if photo.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(415, "Upload a JPG, PNG or WEBP photo")
    data = await photo.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(413, "Photo too large (max 8 MB)")
    photo_hash = hashlib.sha256(data).hexdigest()  # store this to reject duplicates
    try:
        resp = gemini().models.generate_content(
            model=MODEL,
            contents=[types.Part.from_bytes(data=data, mime_type=photo.content_type), OCR_PROMPT],
            config=types.GenerateContentConfig(
                response_mime_type="application/json", response_schema=MeterReading, temperature=0
            ),
        )
        reading = MeterReading(**json.loads(resp.text))
    except HTTPException:
        raise
    except Exception as e:  # model or parsing failure: never return a guessed number
        raise HTTPException(502, f"Could not read the meter photo ({type(e).__name__}); please retake it")
    # TODO: insert into meter_readings with photo_hash; if confidence < 0.85 ask the user to confirm
    return reading


class Appliance(BaseModel):
    type: str
    watts: float
    qty: int = 1
    hours: float


@app.post("/twin/nameplate")
def twin_nameplate(appliances: list[Appliance]):
    kwh_day = nameplate_kwh_per_day([a.model_dump() for a in appliances])
    month_units = kwh_day * 30
    bill = tariff_calc(month_units)
    return {"kwh_per_day": round(kwh_day, 2), "est_month_units": round(month_units, 1),
            "est_month_bill_tk": bill.total_tk, "method": "nameplate estimate (watts x qty x hours)"}
