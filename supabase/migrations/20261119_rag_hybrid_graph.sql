-- Bill Bachao coach: contextual chunks + hybrid search (vector + full-text, RRF) + knowledge graph.
-- Applied to the live project as migrations rag_hybrid_graph and hybrid_search_word_boundaries.
create extension if not exists pg_net with schema extensions;

alter table public.rag_chunks drop column if exists embedding;
alter table public.rag_chunks add column embedding extensions.vector(384);           -- gte-small
alter table public.rag_chunks add column if not exists chunk_key text unique;
alter table public.rag_chunks add column if not exists doc text;
alter table public.rag_chunks add column if not exists section text;
alter table public.rag_chunks add column if not exists fts tsvector
  generated always as (to_tsvector('simple', coalesce(section,'') || ' ' || coalesce(context_prefix,'') || ' ' || coalesce(chunk_text,''))) stored;
create index if not exists rag_chunks_fts_idx on public.rag_chunks using gin (fts);
create index if not exists rag_chunks_embedding_idx on public.rag_chunks using hnsw (embedding extensions.vector_cosine_ops);

create table if not exists public.kg_nodes (id text primary key, type text not null, name text not null, aliases text[] not null default '{}');
create table if not exists public.kg_edges (
  src text references public.kg_nodes(id) on delete cascade, rel text not null,
  dst text references public.kg_nodes(id) on delete cascade, primary key (src, rel, dst));
create table if not exists public.chunk_entities (
  chunk_key text references public.rag_chunks(chunk_key) on delete cascade,
  node_id text references public.kg_nodes(id) on delete cascade, primary key (chunk_key, node_id));
create index if not exists kg_edges_dst_idx on public.kg_edges (dst);
create index if not exists chunk_entities_node_idx on public.chunk_entities (node_id);
alter table public.kg_nodes enable row level security;
alter table public.kg_edges enable row level security;
alter table public.chunk_entities enable row level security;
create policy "graph readable" on public.kg_nodes for select to authenticated using (true);
create policy "edges readable" on public.kg_edges for select to authenticated using (true);
create policy "links readable" on public.chunk_entities for select to authenticated using (true);

-- Whole-word match for English aliases ("ill" must not match "bill"); substring for Bangla.
create or replace function public.alias_in(alias text, txt text)
returns boolean language sql immutable set search_path = public as $$
  select case
    when alias ~ '^[ -~]+$'
      then txt ~ ('(^|[^a-z0-9])' || regexp_replace(lower(alias), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '([^a-z0-9]|$)')
    else position(alias in txt) > 0
  end;
$$;

-- Vector rank and full-text rank fused with reciprocal rank fusion (k = 60),
-- plus a small boost for chunks linked to graph entities named in the question.
create or replace function public.hybrid_search(
  query_text text, query_embedding extensions.vector(384), match_count int default 5, graph_weight float default 0.01)
returns table (chunk_key text, doc_title text, section text, source_url text, chunk_text text,
               vec_rank int, fts_rank int, graph_hit boolean, score float)
language sql stable set search_path = public, extensions as $$
with q as (select lower(query_text) as t),
seed as (select n.id from kg_nodes n, q where exists (select 1 from unnest(n.aliases) a where public.alias_in(a, q.t))),
vec as (
  select c.chunk_key, row_number() over (order by c.embedding <=> query_embedding)::int as r
  from rag_chunks c where c.embedding is not null order by c.embedding <=> query_embedding limit 20),
fts as (
  select c.chunk_key, row_number() over (order by ts_rank_cd(c.fts, websearch_to_tsquery('simple', query_text)) desc)::int as r
  from rag_chunks c where c.fts @@ websearch_to_tsquery('simple', query_text) limit 20),
fts_or as (   -- looser OR match (stop-words removed) when the strict query finds nothing
  select c.chunk_key, row_number() over (order by ts_rank_cd(c.fts, to_tsquery('simple', w.q)) desc)::int as r
  from rag_chunks c,
       (select string_agg(quote_literal(x), ' | ') as q
          from unnest(regexp_split_to_array(lower(query_text), '[^[:alnum:]]+')) x
         where length(x) > 2
           and x not in ('the','and','for','what','how','why','does','can','you','are','with','that','this','from','much','many','who','when','will','should','not','but','about','into','has','have','was','is','my','our','your')) w
  where w.q is not null and c.fts @@ to_tsquery('simple', w.q) limit 20),
kw as (select * from fts union all select * from fts_or where not exists (select 1 from fts)),
g as (select distinct ce.chunk_key from chunk_entities ce join seed s on ce.node_id = s.id),
fused as (select coalesce(v.chunk_key, k.chunk_key) as chunk_key, v.r as vr, k.r as kr
          from vec v full outer join kw k on v.chunk_key = k.chunk_key)
select c.chunk_key, c.doc_title, c.section, c.source_url, c.chunk_text, f.vr, f.kr, (g.chunk_key is not null),
       coalesce(1.0/(60+f.vr),0) + coalesce(1.0/(60+f.kr),0) + case when g.chunk_key is not null then graph_weight else 0 end
from fused f join rag_chunks c on c.chunk_key = f.chunk_key left join g on g.chunk_key = f.chunk_key
order by 9 desc limit match_count;
$$;

-- One-hop graph neighbours, shown by the coach as related topics.
create or replace function public.related_topics(query_text text)
returns table (topic text, rel text, related text) language sql stable set search_path = public as $$
  with seed as (select n.id, n.name from kg_nodes n
                where exists (select 1 from unnest(n.aliases) a where public.alias_in(a, lower(query_text))))
  select s.name, e.rel, n2.name from seed s join kg_edges e on e.src = s.id join kg_nodes n2 on n2.id = e.dst
  union
  select n2.name, e.rel, s.name from seed s join kg_edges e on e.dst = s.id join kg_nodes n2 on n2.id = e.src;
$$;

revoke execute on function public.hybrid_search(text, extensions.vector, int, float) from anon;
revoke execute on function public.related_topics(text) from anon;
