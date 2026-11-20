# Bill Bachao — বিল বাঁচাও

**Live prototype:** https://mijan-x.github.io/bill-bachao/  (simulated demo household; no real personal data)

Bill Bachao cuts household electricity bills and the evening grid peak in Bangladesh, using only phone photos of the meter.
ClimateSphere AI → Energy Brain · International AI Builders Congress 2026 · Team JU_Segfault

## What is in here
| Path | What it does | Status |
|---|---|---|
| `api/tariff.py` | BERC June 2026 residential tariff (progressive blocks, lifeline, demand charge, 5% VAT) | tested |
| `api/twin.py` | Nameplate estimate, cooling regression (kWh = b + c·CDD), Slab Guard forecast, AC saving range | tested |
| `api/main.py` | FastAPI: `/health`, `/tariff`, `/twin/nameplate`, `/ocr/meter` (Gemini vision → strict JSON) | runs and tested; `/ocr/meter` needs `GEMINI_API_KEY` and is not yet tested on real meter photos |
| `local/redactor.py` | For the team laptop: Tesseract + regex + Ollama qwen2.5 removes personal data from bill photos | written, not yet run (needs Tesseract + Ollama) |
| `mcp/server.py` | `bill-bachao-mcp` (FastMCP): read-only tools over stdio or Streamable HTTP (`/mcp` on port 8001) | runs and tested |
| `db/schema.sql` | Supabase tables, row-level security, tariff seed | **deployed** (Supabase, Singapore) |
| `knowledge/`, `rag/` | Coach knowledge base (5 docs, 28 chunks), context lines, knowledge graph, retrieval test | **deployed**, 15/15 top-3 |
| `supabase/` | Edge Functions `embed-chunks` + `coach` (hybrid RAG + graph) and the RAG migration | **deployed** |
| `scripts/seed_demo.py` | 60 days of SIMULATED readings for the public demo | runs |
| `web/` | Public prototype: dashboard, Slab Guard, home twin, tariff, Peak Hour Hero preview, live Ask the coach | live on GitHub Pages |
| `docs/` | Architecture, master prompt | |
| `tests/` | pytest: tariff, twin, API endpoints, MCP tools (18) · node: browser logic + heat-safety rules (13) | 31 passing |

## Quick start
```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r api/requirements.txt -r mcp/requirements.txt pytest
cp .env.example .env                                    # fill in your keys
pytest -q                                               # 18 Python tests
node --test tests/logic.test.js                         # 13 JS tests (same tariff checks + safety rules)
cd api && uvicorn main:app --reload --port 8000         # open http://localhost:8000/docs
```

## Real vs simulated
| Part | Status |
|---|---|
| Tariff calculator | Real, unit-tested |
| Meter OCR (Gemini vision) | Built; not yet tested on real meter photos |
| Coach retrieval (hybrid RAG + knowledge graph) | Real, live in Supabase; answer generation waits for a Gemini key |
| Bill redaction (local Ollama) | Written; not yet run |
| Demo household "Rina" | Simulated |
| Heat-safety rules | Real, unit-tested (JS) |
| Peak Hour Hero | Preview in the demo (safety rules + saving range); photo verification planned for the final |
| Area MW totals | Simulated |

## AI tooling disclosure
Starter code drafted with an AI assistant (Claude) and reviewed and tested by the team. Rules files: `.cursor/rules`. The one-line chunk contexts in `rag/context_lines.json` and the knowledge graph were drafted with Claude and checked by the team.
