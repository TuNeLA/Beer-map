-- 0401 MISC · GRUNDARE (F4): every account made before the store launch keeps Premium forever. OWNER-RUN at release.
-- Additive only: two new tables and new functions. No row-removing or object-removing statement in this file.
-- The launch date is NOT in the code. The owner sets it once, at store launch, in the owner panel
-- (docs/stats-misc.js → owner_set_founder_cutoff). Until then the setting row is empty and every account is
-- "before the launch", so everyone is a founder (final = false).
--   founder_cutoff          one row (id 1): the cutoff time + when it was set.
--   founder_marks           the frozen list: owner_set_founder_cutoff copies every account made before the cutoff here,
--                           so the flag stays even if the cutoff is changed later (marks are never taken away).
--   olnu_is_founder(uid)    mark, or the account (auth.users.created_at) is older than the cutoff (no cutoff = true).
--   olnu_has_premium(uid)   THE check for any later Premium feature: founder today; purchases are added here later.
--   my_founder()            for the app: { founder, final, cutoff, since }. "Grundare" badge in Profil (MISC.founderBadge).
--   owner_founders(key) / owner_set_founder_cutoff(key, at)   the owner panel.
-- founder_marks.user_id: the "Radera mitt konto" sweep (0209) removes the mark together with the account.

create table if not exists public.founder_cutoff (
  id      smallint primary key default 1 check (id = 1),
  cutoff  timestamptz,
  set_at  timestamptz
);
alter table public.founder_cutoff enable row level security;
revoke all on table public.founder_cutoff from public, anon, authenticated;

create table if not exists public.founder_marks (
  user_id   uuid primary key,
  marked_at timestamptz not null default now(),
  source    text not null default 'cutoff' check (source in ('cutoff', 'owner'))
);
alter table public.founder_marks enable row level security;
revoke all on table public.founder_marks from public, anon, authenticated;

create or replace function public.olnu_founder_cutoff()
returns timestamptz language sql stable security definer set search_path to 'public' as $$
  select c.cutoff from public.founder_cutoff c where c.id = 1;
$$;

create or replace function public.olnu_is_founder(p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public', 'auth' as $$
  select p_uid is not null and (
    exists (select 1 from public.founder_marks f where f.user_id = p_uid)
    or coalesce((select u.created_at from auth.users u where u.id = p_uid)
                < coalesce(public.olnu_founder_cutoff(), 'infinity'::timestamptz), false));
$$;

create or replace function public.olnu_has_premium(p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.olnu_is_founder(p_uid);
$$;

create or replace function public.my_founder()
returns jsonb language plpgsql stable security definer set search_path to 'public', 'auth' as $$
declare v_uid uuid := public.olnu_uid(); v_cut timestamptz := public.olnu_founder_cutoff();
begin
  return jsonb_build_object('v', 1,
    'founder', public.olnu_is_founder(v_uid),
    'premium', public.olnu_has_premium(v_uid),
    'final', v_cut is not null,
    'cutoff', v_cut,
    'since', (select u.created_at from auth.users u where u.id = v_uid));
end; $$;

create or replace function public.owner_founders(p_key text)
returns jsonb language plpgsql security definer set search_path to 'public', 'auth' as $$
declare v_cut timestamptz := public.olnu_founder_cutoff();
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('v', 1, 'cutoff', v_cut,
    'set_at', (select c.set_at from public.founder_cutoff c where c.id = 1),
    'marks', (select count(*) from public.founder_marks),
    'users', (select count(*) from auth.users),
    'founders', (select count(*) from auth.users u where public.olnu_is_founder(u.id)));
end; $$;

-- Set (or move) the launch cutoff. Every account made before it gets a mark now (marks are never taken away).
-- At most 1 year back or ahead, so a typo cannot hide every account.
create or replace function public.owner_set_founder_cutoff(p_key text, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path to 'public', 'auth' as $$
declare v_n int;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if p_at is null or p_at < now() - interval '365 days' or p_at > now() + interval '365 days' then
    raise exception 'invalid_cutoff';
  end if;
  insert into public.founder_cutoff as c (id, cutoff, set_at) values (1, p_at, now())
  on conflict (id) do update set cutoff = excluded.cutoff, set_at = now();
  insert into public.founder_marks (user_id, source)
  select u.id, 'cutoff' from auth.users u where u.created_at < p_at
  on conflict (user_id) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'cutoff', p_at, 'new_marks', v_n, 'marks', (select count(*) from public.founder_marks));
end; $$;

revoke all on function public.olnu_founder_cutoff() from public, anon, authenticated;
revoke all on function public.olnu_is_founder(uuid) from public, anon, authenticated;
revoke all on function public.olnu_has_premium(uuid) from public, anon, authenticated;
revoke all on function public.my_founder() from public, anon;
grant execute on function public.my_founder() to authenticated;
grant execute on function public.owner_founders(text) to anon, authenticated;
grant execute on function public.owner_set_founder_cutoff(text, timestamptz) to anon, authenticated;
