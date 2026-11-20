// Bill Bachao coach: hybrid RAG (vector + full-text, fused with RRF) + knowledge-graph boost.
// Retrieval always runs. A grounded answer is generated only if GEMINI_API_KEY is set as a secret;
// otherwise the coach returns the retrieved sources so it never invents an answer.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const session = new Supabase.ai.Session("gte-small");
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You are Bill Bachao's electricity coach for households in Bangladesh.
Answer ONLY from the numbered sources. If the sources do not contain the answer, say you don't know.
Never calculate a bill yourself; say the app's tariff calculator does that.
Never advise an AC above 27 C, never advise switching fans off, and never give medical advice (say: call 999 in an emergency).
Reply in the same language as the question (Bangla or English), in at most 4 short sentences, and cite sources like [1].`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers: cors });

  let body: { question?: string; k?: number };
  try { body = await req.json(); } catch { return Response.json({ error: "JSON body required" }, { status: 400, headers: cors }); }
  const question = (body.question ?? "").toString().trim().slice(0, 500);
  if (!question) return Response.json({ error: "question is required" }, { status: 400, headers: cors });
  const k = Math.min(Math.max(Number(body.k) || 4, 1), 8);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const emb = await session.run(question, { mean_pool: true, normalize: true });
  const [{ data: hits, error }, { data: related }] = await Promise.all([
    db.rpc("hybrid_search", { query_text: question, query_embedding: JSON.stringify(Array.from(emb as number[])), match_count: k }),
    db.rpc("related_topics", { query_text: question }),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500, headers: cors });

  const sources = (hits ?? []).map((h: any, i: number) => ({
    n: i + 1, chunk: h.chunk_key, doc: h.doc_title, section: h.section, url: h.source_url,
    vec_rank: h.vec_rank, fts_rank: h.fts_rank, graph_hit: h.graph_hit, score: Number(h.score.toFixed(4)), text: h.chunk_text,
  }));

  let answer: string | null = null;
  let model: string | null = null;
  let key = Deno.env.get("GEMINI_API_KEY");
  let limited: string | null = null;
  if (key && sources.length) {
    // Daily caps on generated answers (retrieval itself stays unlimited and free).
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("bill-bachao:" + ip));
    const ipHash = Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data: quota } = await db.rpc("take_api_quota", { p_feature: "coach_answer", p_ip_hash: ipHash, p_ip_cap: 40, p_global_cap: 600 });
    if (quota !== "ok") { limited = "Daily limit for written answers reached; showing sources only."; key = undefined; }
  }
  if (key && sources.length) {
    model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite";
    const ctx = sources.map((s) => `[${s.n}] ${s.doc} — ${s.section}\n${s.text}`).join("\n\n");
    const call = (thinking: boolean, m: string = model!) => {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 20_000);
      return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST", signal: ctl.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": key! },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: `Sources:\n${ctx}\n\nQuestion: ${question}` }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024, ...(thinking ? { thinkingConfig: { thinkingLevel: "LOW" } } : {}) },
        }),
      }).finally(() => clearTimeout(timer));
    };
    let r: Response = new Response(null, { status: 599 });
    const FALLBACK = "gemini-flash-lite-latest";
    const tryModel = async (m: string) => {
      let res = await call(true, m);
      if (res.status === 400 && /thinking/i.test(await res.clone().text())) res = await call(false, m);
      return res;
    };
    try {
      try { r = await tryModel(model); } catch { r = new Response(null, { status: 504 }); }
      if ([404, 429, 500, 503, 504].includes(r.status) && model !== FALLBACK) { model = FALLBACK; r = await tryModel(FALLBACK); }
    } catch { limited = "The AI answer timed out; showing sources only."; }
    if (r.ok) {
      const j = await r.json();
      answer = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? null;
      const u = j?.usageMetadata;
      if (u) await db.from("token_usage").insert({ feature: "coach", model, input_tokens: u.promptTokenCount, output_tokens: u.candidatesTokenCount });
    }
  }

  return Response.json({
    question,
    answer,
    model,
    mode: answer ? "rag+llm" : "retrieval-only",
    note: limited,
    related_topics: related ?? [],
    sources,
  }, { headers: cors });
});
