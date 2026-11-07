-- 0190 🔔 NOTISKOLL (owner 2026-11-07; additive, notify-group v27).
-- Per-user push settings: which kinds of push are off, "nattro" (quiet hours, Europe/Stockholm) and a cap per night
-- for the noisy kinds (ute, kaos, bar, kul). Read by the edge function (service role) right before it sends.
-- No row = everything on, no quiet hours, default cap 15 per night. No row is ever removed (push_rx rows are per night).
-- Kinds (olnu_push_cats): ute 🍺 vänner ute (milestones, check-in, kom hit, ETA, hemma/paus, "Kommer!"),
-- chat 💬 gruppchatt + röst, dm 🔒 privata meddelanden, plan 📅 inbjudningar/inkallelser/lägesrapport/skåltimmen,
-- kaos 🔥 KAOS I STAN, bar 🏰 krogtips + övertag, kul ⬆️ befordran/helgstreak/film, vanner 🤝 vänförfrågan.
-- SOS, medevac-koll, Följ mig hem and "letar efter dig" are always on (safety) and ignore nattro and the cap.

create table if not exists public.push_prefs (
  user_id uuid primary key,
  off text[] not null default '{}',
  quiet_from smallint,
  quiet_to smallint,
  cap smallint not null default 0,          -- 0 = default (15); 99 = no cap
  updated_at timestamptz not null default now()
);
alter table public.push_prefs enable row level security;
revoke all on table public.push_prefs from public, anon, authenticated;

create table if not exists public.push_rx (
  user_id uuid not null,
  night timestamptz not null,
  n int not null default 0,
  primary key (user_id, night)
);
alter table public.push_rx enable row level security;
revoke all on table public.push_rx from public, anon, authenticated;

create or replace function public.olnu_push_cats()
returns text[] language sql immutable set search_path to 'public' as $$
  select array['ute','chat','dm','plan','kaos','bar','kul','vanner']::text[]
$$;

create or replace function public.olnu_push_prefs_of(p_uid uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'v', 1,
    'off', coalesce(to_jsonb(p.off), '[]'::jsonb),
    'quiet_from', p.quiet_from,
    'quiet_to', p.quiet_to,
    'cap', coalesce(p.cap, 0),
    'cap_default', 15,
    'cats', to_jsonb(public.olnu_push_cats()),
    'tonight', coalesce((select r.n from public.push_rx r where r.user_id = p_uid and r.night = public.olnu_night_of(now())), 0)
  )
  from (select 1) one left join public.push_prefs p on p.user_id = p_uid
$$;

create or replace function public.my_push_prefs()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid();
begin
  return public.olnu_push_prefs_of(v_uid);
end $$;

create or replace function public.set_push_prefs(p_off text[], p_quiet_from int default null, p_quiet_to int default null, p_cap int default 0)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); v_off text[];
begin
  select coalesce(array_agg(distinct x order by x), '{}') into v_off
    from unnest(coalesce(p_off, '{}')) x where x = any(public.olnu_push_cats());
  if coalesce(array_length(p_off, 1), 0) > 20 then raise exception 'invalid_pref'; end if;
  if (p_quiet_from is null) <> (p_quiet_to is null) then raise exception 'invalid_pref'; end if;
  if p_quiet_from is not null and (p_quiet_from not between 0 and 23 or p_quiet_to not between 0 and 23 or p_quiet_from = p_quiet_to) then
    raise exception 'invalid_pref';
  end if;
  if coalesce(p_cap, 0) not in (0, 5, 10, 20, 99) then raise exception 'invalid_pref'; end if;
  insert into public.push_prefs (user_id, off, quiet_from, quiet_to, cap, updated_at)
  values (v_uid, v_off, p_quiet_from, p_quiet_to, coalesce(p_cap, 0), now())
  on conflict (user_id) do update set off = excluded.off, quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to,
    cap = excluded.cap, updated_at = now();
  return public.olnu_push_prefs_of(v_uid);
end $$;

-- Service role only (notify-group): count one noisy push per user for tonight, refuse users at their cap.
-- Returns the user ids that may get the push. Atomic per user (insert ... on conflict do update ... where n < cap).
create or replace function public.push_rx_take(p_uids uuid[], p_caps int[])
returns setof uuid language plpgsql security definer set search_path to 'public' as $$
declare v_night timestamptz := public.olnu_night_of(now()); i int; v_u uuid; v_cap int; v_got uuid;
begin
  for i in 1 .. coalesce(array_length(p_uids, 1), 0) loop
    v_u := p_uids[i]; v_cap := greatest(1, coalesce(p_caps[i], 15));
    if v_u is null then continue; end if;
    v_got := null;
    insert into public.push_rx as r (user_id, night, n) values (v_u, v_night, 1)
      on conflict (user_id, night) do update set n = r.n + 1 where r.n < v_cap
      returning r.user_id into v_got;
    if v_got is not null then return next v_u; end if;
  end loop;
end $$;

revoke all on function public.olnu_push_cats() from public, anon;
revoke all on function public.olnu_push_prefs_of(uuid) from public, anon, authenticated;
revoke all on function public.my_push_prefs() from public, anon;
revoke all on function public.set_push_prefs(text[], int, int, int) from public, anon;
revoke all on function public.push_rx_take(uuid[], int[]) from public, anon, authenticated;
grant execute on function public.olnu_push_cats() to authenticated;
grant execute on function public.my_push_prefs() to authenticated;
grant execute on function public.set_push_prefs(text[], int, int, int) to authenticated;
grant execute on function public.push_rx_take(uuid[], int[]) to service_role;
