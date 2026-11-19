// Embeds knowledge chunks that have no embedding yet, using Supabase's built-in gte-small model (384 dims).
// Idempotent: only rows with embedding IS NULL are touched, so repeat calls do nothing.
// Small batches (default 4) keep each call inside the Edge Function compute limit; call again until remaining = 0.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const session = new Supabase.ai.Session("gte-small");

Deno.serve(async (req) => {
  const n = Math.min(Math.max(Number(new URL(req.url).searchParams.get("n")) || 4, 1), 8);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: rows, error } = await db
    .from("rag_chunks")
    .select("chunk_key, section, context_prefix, chunk_text")
    .is("embedding", null)
    .order("chunk_key")
    .limit(n);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let done = 0;
  for (const r of rows ?? []) {
    // Contextual retrieval: embed the context line + section + text together.
    const input = `${r.context_prefix ?? ""}\n${r.section ?? ""}\n${r.chunk_text ?? ""}`;
    const emb = await session.run(input, { mean_pool: true, normalize: true });
    const { error: upErr } = await db
      .from("rag_chunks")
      .update({ embedding: JSON.stringify(Array.from(emb as number[])) })
      .eq("chunk_key", r.chunk_key);
    if (!upErr) done++;
  }
  const { count } = await db.from("rag_chunks").select("chunk_key", { count: "exact", head: true }).is("embedding", null);
  return Response.json({ embedded: done, remaining: count ?? null });
});
