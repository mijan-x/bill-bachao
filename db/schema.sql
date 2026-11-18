-- Bill Bachao: preliminary schema. Run in Supabase -> SQL Editor.
create extension if not exists vector;

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  utility text check (utility in ('DESCO','DPDC','NESCO','BPDB','BREB','WZPDCL','Other')),
  meter_type text check (meter_type in ('prepaid','postpaid')),
  area text,                      -- thana level only, no GPS
  sanctioned_kw numeric default 0,
  vulnerable_flag boolean default false,   -- optional, needs consent
  is_simulated boolean default false,
  created_at timestamptz default now()
);

create table if not exists consents (
  id bigserial primary key,
  household_id uuid references households(id) on delete cascade,
  purpose text not null,           -- photos | ai_chat | demand_response | offers
  granted_at timestamptz default now(),
  withdrawn_at timestamptz
);

create table if not exists meter_readings (
  id bigserial primary key,
  household_id uuid references households(id) on delete cascade,
  taken_at timestamptz not null default now(),
  kwh_cumulative numeric,
  balance_tk numeric,
  photo_path text,
  photo_hash text,
  ocr_confidence numeric,
  confirmed_by_user boolean default false,
  source text default 'photo',     -- photo | manual | simulated
  unique (household_id, photo_hash)
);

create table if not exists appliances (
  id bigserial primary key,
  household_id uuid references households(id) on delete cascade,
  type text, watts numeric, star_rating int, qty int default 1,
  est_hours_per_day numeric, source text default 'nameplate'
);

create table if not exists weather_daily (
  area text, date date, t_mean numeric, t_max numeric, humidity numeric,
  primary key (area, date)
);

create table if not exists tariff_slabs (
  id bigserial primary key,
  category text default 'LT-A residential',
  from_unit numeric, to_unit numeric, rate_tk numeric,
  effective_from date, source_url text
);

create table if not exists rag_chunks (
  id bigserial primary key,
  doc_title text, source_url text,
  context_prefix text, chunk_text text,
  embedding vector(1024)           -- bge-m3
);

create table if not exists token_usage (
  id bigserial primary key, at timestamptz default now(),
  feature text, model text, input_tokens int, output_tokens int, cost_usd numeric
);

create table if not exists audit_logs (
  id bigserial primary key, at timestamptz default now(),
  actor uuid, action text, target text
);

-- Row-level security: each user sees only their own household data
alter table households enable row level security;
alter table consents enable row level security;
alter table meter_readings enable row level security;
alter table appliances enable row level security;

create policy "own household" on households for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own consents" on consents for all using (household_id in (select id from households where owner_id = auth.uid()));
create policy "own readings" on meter_readings for all using (household_id in (select id from households where owner_id = auth.uid()));
create policy "own appliances" on appliances for all using (household_id in (select id from households where owner_id = auth.uid()));

-- Tariff seed (BERC, June 2026 billing cycle). Lifeline (<=50 units total) is handled in code at Tk 4.63.
insert into tariff_slabs (from_unit, to_unit, rate_tk, effective_from, source_url) values
 (0, 75, 5.26, '2026-06-01', 'https://observerbd.com/news/578237'),
 (76, 200, 8.50, '2026-06-01', 'https://thefinancialexpress.com.bd/views/views/power-tariff-adjustment-alone-will-not-reduce-subsidy-burdens'),
 (201, 300, 9.10, '2026-06-01', 'https://thefinancialexpress.com.bd/views/views/power-tariff-adjustment-alone-will-not-reduce-subsidy-burdens'),
 (301, 400, 9.62, '2026-06-01', 'https://thefinancialexpress.com.bd/views/views/power-tariff-adjustment-alone-will-not-reduce-subsidy-burdens'),
 (401, 600, 15.01, '2026-06-01', 'https://thefinancialexpress.com.bd/views/views/power-tariff-adjustment-alone-will-not-reduce-subsidy-burdens'),
 (601, null, 17.35, '2026-06-01', 'https://bdnews24.com/economy/9efadd3c57ad');

-- Vector search helper for the coach
create or replace function match_chunks(query_embedding vector(1024), match_count int default 5)
returns table (id bigint, doc_title text, source_url text, chunk_text text, similarity float)
language sql stable as $$
  select id, doc_title, source_url, chunk_text, 1 - (embedding <=> query_embedding) as similarity
  from rag_chunks order by embedding <=> query_embedding limit match_count;
$$;
