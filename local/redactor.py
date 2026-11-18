"""Runs on the team laptop next to Ollama. Exposed ONLY via Cloudflare Tunnel, protected by an API key.
Run: uvicorn redactor:app --port 8010
Needs: Tesseract installed (with Bengali 'ben' + 'eng' language data), Ollama running with qwen2.5:7b."""
import io, os, re
import httpx, pytesseract
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from PIL import Image

API_KEY = os.environ["REDACTOR_API_KEY"]
OLLAMA = os.getenv("OLLAMA_URL", "http://localhost:11434")
app = FastAPI(title="Bill Bachao local redactor")

PATTERNS = [
    (re.compile(r"\b01[3-9]\d{8}\b"), "[PHONE]"),        # BD mobile numbers
    (re.compile(r"\b\d{10,17}\b"), "[ACCOUNT/NID]"),      # long ID / account / meter numbers
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"), "[EMAIL]"),
]


def regex_redact(text: str) -> str:
    for pat, repl in PATTERNS:
        text = pat.sub(repl, text)
    return text


@app.post("/redact-bill")
async def redact_bill(photo: UploadFile = File(...), x_api_key: str = Header(...)):
    if x_api_key != API_KEY:
        raise HTTPException(401, "bad key")
    img = Image.open(io.BytesIO(await photo.read()))
    raw = pytesseract.image_to_string(img, lang="ben+eng")
    text = regex_redact(raw)
    prompt = (
        "From this electricity bill text, return JSON with keys units (number), amount_tk (number), "
        "period (string). Replace any person's name or address with [REDACTED]. Text:\n" + text
    )
    r = httpx.post(f"{OLLAMA}/api/generate",
                   json={"model": "qwen2.5:7b", "prompt": prompt, "stream": False, "format": "json"},
                   timeout=120)
    r.raise_for_status()
    return {"fields": r.json().get("response"), "redacted_text_preview": text[:500]}
