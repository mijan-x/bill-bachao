# Bill Bachao — Master Prompt (one prompt, 8 modules)

> Paste this whole prompt ONCE into your AI builder (Claude Code, Cursor, Lovable or Bolt). After that, reply only with "Continue", "Yes", "Approve" or "Deploy".
> Before pasting, fill in the three values in [BRACKETS] in the "Environment" part.

---

You are a senior full-stack AI engineer and product lead. Build **Bill Bachao**, a production-grade, AI-native web app for the International AI Builders Congress 2026 (track: Idea to Unicorn; domain: ClimateSphere AI; challenge: Energy Brain, "smart energy optimization and demand response").

Work in stages. At the start, print a numbered build plan of all stages. After each stage, show what you built, the files changed and how to test it, then wait for me to say "Continue". Never invent data, and never hard-code secrets. Every number shown to a user must come from a tested function, never from free LLM text. Label simulated data "Simulated" everywhere it appears.

## Environment
- Repo name: `bill-bachao` (monorepo: `web/`, `api/`, `local/`, `mcp/`, `agents/`, `rag/`, `n8n/`, `infra/`, `specs/`, `docs/`, `tests/`)
- Frontend: Next.js 14+ (App Router), TypeScript, Tailwind, shadcn/ui; Bangla-first with an English toggle; mobile-first
- Backend: Python 3.11, FastAPI, Pydantic v2
- Database/Auth/Storage: Supabase (Postgres + pgvector + Auth + private Storage buckets). Project URL: [SUPABASE_URL]
- Cloud LLM: [Gemini or Claude] for vision OCR of meter photos, chat and context lines for RAG chunks (all calls through one `llm.py` router)
- Local LLM runtime: Ollama on the team laptop with `qwen2.5:7b` (PII redaction, offline Bangla fallback), `bge-m3` (multilingual embeddings) and, if available, `llama3.2-vision` (on-device bill OCR). Reached only through `local/redactor` behind an API key, exposed by Cloudflare Tunnel at [TUNNEL_URL]
- Agents: LangGraph. Automation: n8n (workflow JSON files in `n8n/`). MCP: Python FastMCP
- Hosting: web on Vercel, API on Render, Docker Compose for local runs

## Module 1 — Core product and AI
**Concept:** Bill Bachao cuts household electricity bills and the evening grid peak using only phone photos of the meter. There is no hardware. It is Bangladesh's first people-powered demand response.

**Target users:** households on DESCO, DPDC, NESCO, BPDB or BREB meters (prepaid or postpaid). Partners: electricity distributors, efficient-appliance brands, banks and MFIs.

**Features:**
1. **Photo home twin.** The user uploads meter-screen photos, bill photos and appliance nameplate photos. OCR returns strict JSON (`kwh_cumulative`, `balance_tk`, `confidence`; nameplate: `type`, `watts`, `star_rating`). If confidence is below 0.85, the user confirms. Bill photos are processed only through `local/redactor`. Model:
   - From 7 readings on: kWh_d = b + c·CDD_d, where CDD_d = max(0, T_mean − 24°C). Fit per household; store b, c, r², n and the input reading IDs.
   - Before that: Σ watts × qty × hours ÷ 1000.
   - Output: cooling vs base load in kWh and Tk, with a confidence label.
2. **Slab Guard.** Forecast month-end units, warn before a slab edge and give the smallest AC change (°C) that keeps the user under it, with the Tk difference. For prepaid meters, give the run-out date.
3. **Bangla voice and chat coach.** A LangGraph agent: intent → tools (`tariff_calc`, `get_home_twin`, `slab_forecast`, `rag_search`) → answer in simple Bangla with cited sources → guardrail check. Voice input and output go through the browser's speech APIs, with text fallback.
4. **Peak Hour Hero.**
   - On a peak event, the Peak Planner agent runs: load context → safety check → choose actions (AC set-point raise; shift pump, iron or washing after 11 PM) → estimate the saving range with ΔE = P_AC × h × d × s × Δθ, where d = 0.6–0.9 and s = 0.03–0.06 per °C → write the Bangla message → explain why.
   - The user accepts with one tap and takes meter photos at the start and end of the window.
   - Verification compares the measured kWh with the twin baseline for the same temperature and reports a range. Points are awarded.
   - Shifted loads count as "kWh moved", not "kWh saved".
5. **Heat-safety guardrail.**
   - Never suggest an AC above 27°C, and never suggest turning off fans.
   - Vulnerable households: AC limit 26°C, and no challenge when the heat index is above 41°C (configurable).
   - Lifeline households (≤ 50 units) get tips only.
   - Challenges are always optional.
6. **Upgrade advisor.** Payback in months for a BLDC fan or an inverter AC, using nameplate data and the tariff. Partner offers are clearly labelled as ads.

**Demo persona to seed:** Rina Akter, Mirpur, Dhaka, DESCO prepaid; 1.5-ton non-inverter AC, 4 fans, fridge, IPS; mother-in-law aged 72 (vulnerable flag). Seed 60 days of her readings, plus 200 simulated households in 5 Dhaka areas for the partner dashboard. Label all of it "Simulated".

**User journeys to implement and test end to end:** onboarding + consent → first twin; Slab Guard warning; coach Q&A with sources; peak challenge → accept → before/after photos → verified range → points.

## Module 2 — Data architecture
- **Tables:** households, consents, meter_readings, bills, appliances, weather_daily, twin_estimates, tariff_slabs, peak_events, challenges, challenge_responses, rewards, rag_documents, rag_chunks (pgvector, 1024-dim for bge-m3), kg_nodes, kg_edges, audit_logs, token_usage, users_roles. Every table gets created_at, updated_at, RLS policies and an SQL migration file.
- **Tariff:** seed `tariff_slabs` with BERC's June 2026 LT-A residential rates and the source URL: lifeline (total ≤ 50 units) Tk 4.63 for all units; progressive blocks 0–75 Tk 5.26, 76–200 Tk 8.50, 201–300 Tk 9.10, 301–400 Tk 9.62, 401–600 Tk 15.01, 600+ Tk 17.35; plus a demand charge per sanctioned kW (configurable) and 5% VAT. `tariff_calc` must pass unit tests against 3 real bills in `tests/fixtures/bills.json`.
- **Pipelines:**
  - Ingestion: photo upload → hash dedupe → OCR → validation → confirm → store.
  - Nightly jobs: Open-Meteo temperature fetch per area into weather_daily; twin refit; slab forecast.
  - RAG ingest: fetch documents → semantic chunking on headings and meaning → an LLM-written 1–2 sentence context line per chunk (contextual retrieval) → bge-m3 embeddings → pgvector.
  - Knowledge graph build: Appliance → uses → kWh; Tip → reduces → Appliance; Slab → priced_at → Tk; Risk → blocks → Tip.
- **Data quality:**
  - Cumulative kWh never decreases. A jump above 3 standard deviations is flagged.
  - Duplicate photo hashes are rejected.
  - Pydantic schemas on every input. Missing weather days are interpolated and marked as such.
- **Lineage:** every derived row stores its input IDs, model name and version.

## Module 3 — Admin module
- **Roles (RBAC):** household, community_champion, partner_analyst (aggregates only), admin.
- **Admin dashboard:** active households, readings per day, OCR confidence distribution, twins fitted, slab warnings sent, peak events, kW committed vs verified (ranges), CO2 avoided (grid emission factor configurable, source cited), points issued, token cost per feature.
- **Partner dashboard:** area totals only, with a CSV export of aggregates. No household-level data.
- **Settings:** tariff tables, peak-event thresholds, heat-index threshold, safety limits, reward rules, feature flags. Every change is written to audit_logs.
- **User management:** invite, role change, deactivate, data-export and delete-account requests.

## Module 4 — Security module
- **Authentication:** Supabase Auth (email magic link and Google). Sessions are JWTs, validated in FastAPI.
- **Authorisation:** RLS on every table; API checks the role per route; MCP tools are read-only and scoped to one household by token.
- **Rate limiting:** per IP and per user on OCR, coach and verify (e.g. 30 requests per minute). Upload size and type are checked.
- **Encryption:** TLS everywhere; Supabase encryption at rest; private buckets with signed URLs that expire in 10 minutes. Photos are deleted after 30 days.
- **PII:** bill photos go only to `local/redactor` (regex for names, addresses, account and meter numbers, plus a `qwen2.5` pass). Personal data never goes into logs.
- **LLM guardrails:**
  - Prompt-injection and off-topic filters on input.
  - On output, no number may appear unless it came from a tool result.
  - No medical advice; for heat illness, refer to 999.
- **Dependencies:** pinned versions, `pip-audit` and `npm audit` in CI. Secrets live only in environment variables; `.env.example` has no values. Never expose Ollama port 11434 directly.

## Module 5 — Documentation module
Generate:
- `README.md`: pitch, screenshots, live link, demo login, quick start.
- `docs/architecture.md`: component diagram in Mermaid and a description of the data flow.
- `docs/api.md`: generated from FastAPI's OpenAPI spec.
- `docs/install.md`: local setup with Docker Compose, Ollama models, Cloudflare Tunnel and n8n import.
- `docs/mcp.md`: tools, transports (stdio and Streamable HTTP), tested hosts, permission boundaries.
- `docs/model-card.md`: models used, purpose, limits, known failure cases.
- `docs/eval-report.md`: OCR accuracy, tariff tests, RAG answer quality, safety tests.
- `docs/responsible-ai.md`: heat-safety, fairness and privacy rules.
- `specs/`: one Spec-Kit spec per feature.

## Module 6 — Audit reporting
- `audit_logs` for: sign-in, consent change, admin setting change, data export, account deletion, partner data access, peak event creation.
- `token_usage` for every LLM call: model, feature, input and output tokens, cost, latency, cache hit.
- **Compliance checks (a nightly job and a page in the admin dashboard):**
  - every processed photo has a consent row;
  - no personal data appears in logs (regex scan);
  - photos older than 30 days are deleted;
  - no safety-rule violations in challenges.
- A weekly report as markdown in `docs/reports/`, also sent through n8n.
- Tracing with Langfuse (or LangSmith): every agent run stores its steps and tool calls.

## Module 7 — Presentation and pitch deck
Generate `docs/pitch/` with a 10-slide outline and speaker notes for a 3-minute pitch:
1. Problem: evening peak and load-shedding; bills rising with the June 2026 tariff.
2. Insight: the government's 25°C appeal cannot be measured or rewarded.
3. Solution: photo twin, Slab Guard, Peak Hour Hero.
4. Live demo moment.
5. How the AI works: input → processing → output, with explainability.
6. Responsible AI: heat safety, fairness, privacy.
7. Business model: distributors pay per verified peak kWh, plus brand leads and green EMI.
8. Market and global readiness: Bangladesh, India, Pakistan, the Philippines, Nigeria.
9. Traction and validation: pilot numbers, interviews, letters.
10. Team and roadmap, including the NRB collaborator.

Add a one-page value proposition and a market analysis with clearly cited sources. Use no number that lacks a source.

## Module 8 — Deployment requirements
- `infra/docker-compose.yml`: api, mcp (HTTP), n8n, local redactor; a healthcheck on each.
- Dockerfiles for api and mcp.
- `.github/workflows/ci.yml`: lint (ruff, eslint), type-check, pytest, a build, `pip-audit` and `npm audit` on every push and pull request.
- Deploy targets: web to Vercel, api to Render, both with environment variables documented in `.env.example`.
- Cloudflare Tunnel config for `local/redactor` and n8n webhooks, with step-by-step notes.
- Seed scripts: tariff, demo persona, simulated households, RAG corpus, knowledge graph.
- Smoke-test script that checks every endpoint after a deploy.

## Done when
- The live URL works on a phone. The demo login works. Every journey in Module 1 passes its end-to-end test.
- `tariff_calc` matches the 3 real bills. Safety tests pass. The MCP server works in Claude Desktop over stdio and over HTTP.
- The README, the docs and the pitch outline exist, and every simulated number is labelled.

Start now by printing the build plan, then wait for "Continue".
