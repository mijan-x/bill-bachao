# Bill Bachao — বিল বাঁচাও

**Live prototype:** https://mijan-x.github.io/bill-bachao/  (simulated demo household; no real personal data)

Bill Bachao cuts household electricity bills and the evening grid peak in Bangladesh, using only phone photos of the meter.
ClimateSphere AI → Energy Brain · International AI Builders Congress 2026 · Team JU_Segfault

## What is in here
| Path | What it does | Status |
|---|---|---|
| `api/tariff.py` | BERC June 2026 residential tariff (progressive blocks, lifeline, demand charge, 5% VAT) | tested |
| `api/twin.py` | Nameplate estimate, cooling regression (kWh = b + c·CDD), Slab Guard forecast, AC saving range | tested |
| `api/main.py` | FastAPI: `/health`, `/tariff`, `/ocr/meter` (Gemini vision → strict JSON), `/twin/nameplate` | runs |
| `local/redactor.py` | Runs on the team laptop: Tesseract + regex + Ollama qwen2.5 removes personal data from bill photos | needs Tesseract + Ollama |
| `mcp/server.py` | `bill-bachao-mcp` (FastMCP): read-only tools over stdio or Streamable HTTP (`/mcp` on port 8001) | runs |
| `db/schema.sql` | Supabase tables, row-level security, tariff seed, vector search function | **deployed** (Supabase, Singapore) |
| `scripts/seed_demo.py` | 60 days of SIMULATED readings for the public demo | runs |
| `web/` | Public prototype: dashboard, Slab Guard, home twin, tariff, Peak Hour Hero preview | live on GitHub Pages |
| `docs/` | Architecture, master prompt | |
| `tests/` | pytest for tariff and twin | 10 passing |

## Quick start
```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r api/requirements.txt -r mcp/requirements.txt pytest
cp .env.example .env                                    # fill in your keys
pytest -q                                               # all tests should pass
cd api && uvicorn main:app --reload --port 8000         # open http://localhost:8000/docs
```

## Real vs simulated
| Part | Status |
|---|---|
| Tariff calculator | Real, unit-tested |
| Meter OCR | Real (Gemini vision) |
| Bill redaction | Real on team laptop |
| Demo household "Rina" | Simulated |
| Peak Hour Hero / MW map | Planned for the final; totals will be simulated |

## AI tooling disclosure
Starter code drafted with an AI assistant (Claude) and reviewed and tested by the team. Rules files: `.cursor/rules`.
