-- Inferred from edge function usage; verify against production before applying.
--
-- Schema + RPCs for the IDEalize download gate:
--   * download_codes                  – one-time 6-digit codes (stored only as SHA-256 hashes)
--   * download_log                    – audit row per successful redemption
--   * ip_rate_limits                  – per-IP throttle counter for request-download
--   * redeem_download_code(email, hash)   – atomic verify+redeem (closes the TOCTOU race)
--   * check_ip_rate_limit(ip, n, mins)    – atomic per-IP request counter
--
-- Apply with: supabase db push   (or paste into the SQL editor)

-- ================= tables =================

create table if not exists public.download_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    integer not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

-- latest active code per email (verify path + per-email rate limit window scan)
create index if not exists download_codes_email_active_idx
  on public.download_codes (email, created_at desc)
  where consumed_at is null;

create table if not exists public.download_log (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.ip_rate_limits (
  ip           text primary key,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);

-- These tables are only ever touched by Edge Functions through the service role.
-- RLS with no policies = deny-all for direct anon/authenticated PostgREST access.
alter table public.download_codes enable row level security;
alter table public.download_log enable row level security;
alter table public.ip_rate_limits enable row level security;

-- ================= redeem_download_code =================
-- Verifies and redeems a code atomically. The SELECT ... FOR UPDATE row lock
-- serializes concurrent calls for the same email, so the 5-attempt cap holds
-- and a code can be redeemed exactly once. Returns one of:
--   'redeemed'           – hash matched; row now consumed
--   'too_many_attempts'  – attempts cap reached (row kept for the audit trail)
--   'invalid'            – no active row, expired, or wrong hash (deliberately
--                          indistinguishable to the caller)
create or replace function public.redeem_download_code(p_email text, p_code_hash text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.download_codes%rowtype;
begin
  select * into r
  from public.download_codes
  where email = p_email
    and consumed_at is null
  order by created_at desc
  limit 1
  for update;

  if not found or r.expires_at < now() then
    return 'invalid';
  end if;

  if r.attempts >= 5 then
    return 'too_many_attempts';
  end if;

  update public.download_codes set attempts = attempts + 1 where id = r.id;

  if r.code_hash = p_code_hash then
    update public.download_codes
      set consumed_at = now()
      where id = r.id and consumed_at is null;
    return 'redeemed';
  end if;

  return 'invalid';
end;
$$;

-- Edge Functions call this via the service role; nobody else may.
revoke execute on function public.redeem_download_code(text, text) from public, anon, authenticated;
grant execute on function public.redeem_download_code(text, text) to service_role;

-- ================= check_ip_rate_limit =================
-- Atomic per-IP sliding-window counter (single INSERT ... ON CONFLICT, so
-- concurrent requests serialize on the row lock). Counts the current request;
-- returns true while within p_limit requests per p_window_min minutes.
create or replace function public.check_ip_rate_limit(p_ip text, p_limit integer, p_window_min integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.ip_rate_limits as l (ip, window_start, count)
  values (p_ip, now(), 1)
  on conflict (ip) do update set
    window_start = case when l.window_start < now() - (p_window_min * interval '1 minute')
                        then now() else l.window_start end,
    count        = case when l.window_start < now() - (p_window_min * interval '1 minute')
                        then 1 else l.count + 1 end
  returning count into n;

  return n <= p_limit;
end;
$$;

revoke execute on function public.check_ip_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_ip_rate_limit(text, integer, integer) to service_role;
