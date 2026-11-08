-- 0391 🔔 NOTISER v2 × BOLD (agent ntf, 2026-11-08). ADDITIVE ONLY. Safe to run again. Cannot send anything by itself.
-- "Kvällsrepris klar" push (bold PLAN.md §3.7): one per group-night, at 10:30 the next morning, only when >= 2 members
-- have >= 2 bar points (crew_tracks.bar_id) that night; to the members with a trail. If the group gets the 10:00 film
-- push, notify-group adds one line to that push instead ("…och kvällsreprisen ä klar ▶") and claims the night here
-- with via = 'film', so no second push comes.
-- Gate: bold_flags.bold_replay (table made by the bold agent, 0380). While that table or row is missing = OFF.
--   replay_push              claim table (group_id, night) → via 'film' | 'push' | 'feed'
--   replay_ready_claim(p_group_id, p_night, p_via, p_uid, p_any_time)   service role. One claim per group-night. p_uid = the caller
--                            (must be a member; null from the cron). Returns {ok, to[], bars, group_name} or {ok:false, why}.
--   replay_ready_due(p_limit, p_test)   service role (cron): last night's qualifying group-nights after 10:30, claimed.
-- No row is ever removed.

create table if not exists public.replay_push (
  group_id uuid not null,
  night    timestamptz not null,
  via      text not null,
  at       timestamptz not null default now(),
  primary key (group_id, night)
);
alter table public.replay_push enable row level security;
revoke all on table public.replay_push from public, anon, authenticated;

-- bold flag (dynamic SQL: works before and after the bold migration; missing = false)
create or replace function public.ntf_bold_on(p_key text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare v boolean;
begin
  if to_regclass('public.bold_flags') is null then return false; end if;
  execute 'select on_ from public.bold_flags where key = $1' into v using p_key;
  return coalesce(v, false);
exception when others then return false;
end $$;

-- Who has a trail, how many have >= 2 bar points (the night = olnu_night_of value of that night).
create or replace function public.ntf_replay_stats(p_group_id uuid, p_night timestamptz)
returns table (trail uuid[], bar2 int, bars int)
language sql stable security definer set search_path to 'public' as $$
  with m as (select gm.user_id from public.group_members gm where gm.group_id = p_group_id),
  t as (select ct.user_id, count(*) filter (where ct.bar_id is not null) as nb, count(distinct ct.bar_id) as db
          from public.crew_tracks ct join m on m.user_id = ct.user_id
         where ct.night = p_night group by ct.user_id)
  select coalesce(array_agg(t.user_id), '{}'), (count(*) filter (where t.nb >= 2))::int,
         coalesce((select count(distinct ct.bar_id)::int from public.crew_tracks ct join m on m.user_id = ct.user_id
                    where ct.night = p_night and ct.bar_id is not null), 0)
    from t
$$;

create or replace function public.replay_ready_claim(p_group_id uuid, p_night timestamptz, p_via text default 'push', p_uid uuid default null,
  p_any_time boolean default false)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_last timestamptz := public.olnu_night_of(now() - interval '1 day');
  v_l timestamp := now() at time zone 'Europe/Stockholm';
  s record; v_n int;
begin
  if not public.ntf_bold_on('bold_replay') then return jsonb_build_object('ok', false, 'why', 'off'); end if;
  p_night := coalesce(p_night, v_last);   -- null = the night that ended this morning
  if p_group_id is null or p_night is null or p_night <> v_last then return jsonb_build_object('ok', false, 'why', 'night'); end if;
  if coalesce(p_via, 'push') not in ('film', 'push', 'feed') then return jsonb_build_object('ok', false, 'why', 'via'); end if;
  if p_uid is not null and not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = p_uid) then
    return jsonb_build_object('ok', false, 'why', 'not_member');
  end if;
  if not coalesce(p_any_time, false) then
    -- the film push (10:00) may merge early; a plain push waits until 10:30. The replay closes at 18:00.
    if coalesce(p_via, 'push') = 'push' and v_l::time < time '10:30' then return jsonb_build_object('ok', false, 'why', 'early'); end if;
    if v_l::time >= time '18:00' or v_l::time < time '05:00' then return jsonb_build_object('ok', false, 'why', 'late'); end if;
  end if;
  select * into s from public.ntf_replay_stats(p_group_id, p_night);
  if coalesce(s.bar2, 0) < 2 then return jsonb_build_object('ok', false, 'why', 'few'); end if;
  insert into public.replay_push (group_id, night, via) values (p_group_id, p_night, coalesce(p_via, 'push')) on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'why', 'claimed'); end if;
  return jsonb_build_object('ok', true, 'to', to_jsonb(s.trail), 'bars', s.bars,
    'group_name', (select g.name from public.groups g where g.id = p_group_id));
end $$;

-- Cron: last night's group-nights with bar points, not claimed yet → claim (via 'push') and return them.
-- p_test = only all-test-user groups and no time window (live tests; service role only).
create or replace function public.replay_ready_due(p_limit int default 100, p_test boolean default false)
returns table (group_id uuid, night timestamptz, group_name text, bars int, recips uuid[])
language plpgsql volatile security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_last timestamptz := public.olnu_night_of(now() - interval '1 day');
  r record; j jsonb; n int := 0;
begin
  if not public.ntf_bold_on('bold_replay') then return; end if;
  for r in
    select distinct gm.group_id as gid from public.crew_tracks ct join public.group_members gm on gm.user_id = ct.user_id
     where ct.night = v_last and ct.bar_id is not null
       and not exists (select 1 from public.replay_push rp where rp.group_id = gm.group_id and rp.night = v_last)
     limit 2000
  loop
    exit when n >= greatest(1, least(500, coalesce(p_limit, 100)));
    if (select bool_and(public.olnu_is_test_user(x.user_id)) from public.group_members x where x.group_id = r.gid) is distinct from coalesce(p_test, false) then continue; end if;
    j := public.replay_ready_claim(r.gid, v_last, 'push', null, coalesce(p_test, false));
    if coalesce((j->>'ok')::boolean, false) then
      group_id := r.gid; night := v_last; group_name := j->>'group_name'; bars := (j->>'bars')::int;
      recips := array(select jsonb_array_elements_text(j->'to')::uuid);
      n := n + 1; return next;
    end if;
  end loop;
end $$;

revoke all on function public.ntf_bold_on(text) from public, anon, authenticated;
revoke all on function public.ntf_replay_stats(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.replay_ready_claim(uuid, timestamptz, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.replay_ready_due(int, boolean) from public, anon, authenticated;
grant execute on function public.ntf_bold_on(text) to service_role;
grant execute on function public.ntf_replay_stats(uuid, timestamptz) to service_role;
grant execute on function public.replay_ready_claim(uuid, timestamptz, text, uuid, boolean) to service_role;
grant execute on function public.replay_ready_due(int, boolean) to service_role;
