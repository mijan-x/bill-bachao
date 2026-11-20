-- Usage log + daily caps for the public AI endpoints (applied live as migration api_usage_limits).
-- Stores only a salted SHA-256 hash of the caller's IP, never the IP or the photo.
create table if not exists public.api_usage (
  id bigserial primary key,
  feature text not null check (feature in ('ocr_meter','coach_answer')),
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists api_usage_feature_time_idx on public.api_usage (feature, created_at desc);
create index if not exists api_usage_ip_idx on public.api_usage (ip_hash, feature, created_at desc);
alter table public.api_usage enable row level security;  -- no policies: service role (Edge Functions) only

create or replace function public.take_api_quota(p_feature text, p_ip_hash text, p_ip_cap int, p_global_cap int)
returns text language plpgsql security invoker set search_path = public as $$
declare ip_n int; all_n int;
begin
  perform pg_advisory_xact_lock(hashtext('api_usage:' || p_feature));
  select count(*) into all_n from api_usage where feature = p_feature and created_at > now() - interval '1 day';
  if all_n >= p_global_cap then return 'global_limit'; end if;
  select count(*) into ip_n from api_usage where feature = p_feature and ip_hash = p_ip_hash and created_at > now() - interval '1 day';
  if ip_n >= p_ip_cap then return 'ip_limit'; end if;
  insert into api_usage(feature, ip_hash) values (p_feature, p_ip_hash);
  return 'ok';
end;
$$;
revoke execute on function public.take_api_quota(text, text, int, int) from public, anon, authenticated;
grant execute on function public.take_api_quota(text, text, int, int) to service_role;
