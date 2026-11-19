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
  const key = Deno.env.get("GEMINI_API_KEY");
  if (key && sources.length) {
    model = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
    const ctx = sources.map((s) => `[${s.n}] ${s.doc} — ${s.section}\n${s.text}`).join("\n\n");
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: `Sources:\n${ctx}\n\nQuestion: ${question}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
      }),
    });
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
    related_topics: related ?? [],
    sources,
  }, { headers: cors });
});
