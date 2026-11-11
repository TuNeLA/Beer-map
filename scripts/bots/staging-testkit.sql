-- PintsNow TEST KIT · STAGING ONLY (project vdtmzsxajpvzwwbhnfmr). NEVER run this on the live project.
-- Used by the test build (tunela.github.io/pintsnow-beta/test/, testenv/testbar.js) and the bots (scripts/bots/runner.py).
-- The first block stops at once on any database without the schema staging_tools (that schema exists only on staging),
-- and the whole file is one transaction when it runs through the Supabase MCP apply_migration or the SQL editor.
--
-- What it adds (everything is per TEST user; a user without a row in testkit_users gets exactly the old answers):
--   testkit_users     one row per test device / bot: label, bot or not, flag overrides, clock offset.
--   testkit_groups    the shared test groups by label ("Testgänget" → group id + join code), so every bot run finds it.
--   zz_test_join      register this user (also marks it as a test user: olnu_test_users).
--   zz_test_set       set flag overrides and/or the clock offset for me AND every test user in my groups (bots + my
--                     other device), so the whole test gang sees the same flags and the same moment clock.
--   zz_test_state     my flags, my offset, the test group.
--   zz_test_group_get / zz_test_group_set   the shared test group.
--   zz_test_moment    open a moment (vad / halvtid / bord / agent) now in my group. No push rows.
--   zz_test_retire    a new bot set takes over: old bots with the same label leave their groups (through leave_group).
-- Changed on staging (per-user override, else the old body): olnu_crew_now (clock offset), olnu_after_on,
--   after_flags_get, olnu_ride_flag, ride_flags_get, olnu_bold_on, bold_flags_get, ntf_bold_on, push_v2_on,
--   push_v2_flags_get, account_config. Undo: scripts/bots/staging-testkit-undo.sql (the old bodies).
-- Additive: no row-removing or object-removing statement in this file. Safe to run twice.

do $guard$
begin
  if to_regnamespace('staging_tools') is null then
    raise exception 'staging-testkit.sql: this is NOT the staging project (no schema staging_tools). Nothing was changed.';
  end if;
end $guard$;

create table if not exists public.testkit_users (
  user_id      uuid primary key,
  label        text not null default '',
  is_bot       boolean not null default false,
  gen          text,
  retired      boolean not null default false,
  clock_offset interval not null default interval '0',
  flags        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.testkit_users enable row level security;
revoke all on table public.testkit_users from public, anon, authenticated;

create table if not exists public.testkit_groups (
  label      text primary key,
  group_id   uuid not null,
  code       text,
  updated_at timestamptz not null default now()
);
alter table public.testkit_groups enable row level security;
revoke all on table public.testkit_groups from public, anon, authenticated;

-- ---------- helpers read by the overrides (security definer: the caller never reads the table itself) ----------
create or replace function public.zz_test_flag(p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select case when t.flags ? p_key then (t.flags ->> p_key)::boolean end
    from public.testkit_users t where t.user_id = auth.uid() and not t.retired;
$$;
create or replace function public.zz_test_offset()
returns interval language sql stable security definer set search_path to 'public' as $$
  select coalesce((select t.clock_offset from public.testkit_users t where t.user_id = auth.uid() and not t.retired), interval '0');
$$;
revoke all on function public.zz_test_flag(text) from public, anon;
revoke all on function public.zz_test_offset() from public, anon;
grant execute on function public.zz_test_flag(text) to anon, authenticated, service_role;     -- reads only the caller's own row
grant execute on function public.zz_test_offset() to anon, authenticated, service_role;

-- ---------- the overrides ----------
create or replace function public.olnu_crew_now()
returns timestamptz language sql stable set search_path to 'public' as $$
  select coalesce(nullif(current_setting('olnu.crew_now', true), '')::timestamptz, now() + public.zz_test_offset());
$$;

create or replace function public.olnu_after_on(p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.zz_test_flag(p_key), (select f.on_ from public.after_flags f where f.key = p_key), false);
$$;
create or replace function public.after_flags_get()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('v', 1, 'flags', coalesce((select jsonb_object_agg(f.key, coalesce(public.zz_test_flag(f.key), f.on_)) from public.after_flags f), '{}'::jsonb));
$$;
create or replace function public.olnu_ride_flag(p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.zz_test_flag(p_key), (select f.on_ from public.ride_flags f where f.key = p_key), false);
$$;
create or replace function public.ride_flags_get()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(f.key, coalesce(public.zz_test_flag(f.key), f.on_)), '{}'::jsonb) from public.ride_flags f;
$$;
create or replace function public.olnu_bold_on(p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.zz_test_flag(p_key), (select f.on_ from public.bold_flags f where f.key = p_key), false);
$$;
create or replace function public.bold_flags_get()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(f.key, coalesce(public.zz_test_flag(f.key), f.on_)), '{}'::jsonb) from public.bold_flags f;
$$;
create or replace function public.ntf_bold_on(p_key text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare v boolean;
begin
  v := public.zz_test_flag(p_key);
  if v is not null then return v; end if;
  if to_regclass('public.bold_flags') is null then return false; end if;
  execute 'select on_ from public.bold_flags where key = $1' into v using p_key;
  return coalesce(v, false);
exception when others then return false;
end $$;
create or replace function public.push_v2_on(p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.zz_test_flag(p_key), (select f.on_ from public.push_v2_flags f where f.key = p_key), false)
$$;
create or replace function public.push_v2_flags_get()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(f.key, coalesce(public.zz_test_flag(f.key), f.on_)), '{}'::jsonb) from public.push_v2_flags f
$$;
create or replace function public.account_config()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'v', 1,
    'email', coalesce(public.zz_test_flag('email_login'), (select f.enabled from public.app_account_flags f where f.key = 'email_login'), false),
    'google', coalesce((select f.enabled from public.app_account_flags f where f.key = 'google_login'), false)
  );
$$;

-- ---------- RPCs for the test build and the bots ----------
-- zz_test_join: a new device / bot in a test gang gets the gang's current flags + clock (from any registered mate).
create or replace function public.zz_test_join(p_label text default null, p_bot boolean default false, p_gen text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); t public.testkit_users;
begin
  insert into public.olnu_test_users (user_id) values (v_uid) on conflict do nothing;
  insert into public.testkit_users (user_id, label, is_bot, gen)
  values (v_uid, left(coalesce(nullif(btrim(p_label), ''), 'test'), 30), coalesce(p_bot, false), left(p_gen, 40))
  on conflict (user_id) do update set label = coalesce(left(nullif(btrim(p_label), ''), 30), testkit_users.label),
    is_bot = coalesce(p_bot, testkit_users.is_bot), gen = coalesce(left(p_gen, 40), testkit_users.gen), retired = false, updated_at = now()
  returning * into t;
  if t.flags = '{}'::jsonb and t.clock_offset = interval '0' then
    update public.testkit_users me set flags = x.flags, clock_offset = x.clock_offset, updated_at = now()
      from (select o.flags, o.clock_offset from public.testkit_users o
              join public.group_members a on a.user_id = o.user_id
              join public.group_members b on b.group_id = a.group_id and b.user_id = v_uid
             where o.user_id <> v_uid and not o.retired order by o.updated_at desc limit 1) x
     where me.user_id = v_uid;
  end if;
  return public.zz_test_state();
end $$;

create or replace function public.zz_test_state()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); t public.testkit_users;
begin
  select * into t from public.testkit_users where user_id = v_uid;
  return jsonb_build_object('v', 1, 'registered', t.user_id is not null, 'label', t.label, 'bot', coalesce(t.is_bot, false),
    'flags', coalesce(t.flags, '{}'::jsonb), 'offset_min', floor(extract(epoch from coalesce(t.clock_offset, interval '0')) / 60)::int,
    'server_now', now(), 'crew_now', public.olnu_crew_now(),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('label', g.label, 'group_id', g.group_id, 'code', g.code,
                 'member', exists (select 1 from public.group_members m where m.group_id = g.group_id and m.user_id = v_uid)))
               from public.testkit_groups g), '[]'::jsonb),
    'mates', coalesce((select jsonb_agg(jsonb_build_object('label', o.label, 'bot', o.is_bot) order by o.is_bot, o.label)
               from public.testkit_users o where not o.retired and o.user_id <> v_uid and exists (
                 select 1 from public.group_members a join public.group_members b on b.group_id = a.group_id
                  where a.user_id = o.user_id and b.user_id = v_uid)), '[]'::jsonb));
end $$;

-- p_flags: {"moments": true, "ride_v2": false, ...}; a key with JSON null removes the override.
-- p_offset_min: minutes to add to the moment clock (null = keep, 0 = real time).
create or replace function public.zz_test_set(p_flags jsonb default null, p_offset_min integer default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); v_set jsonb := '{}'::jsonb; v_del text[] := '{}'; k text; v jsonb;
begin
  if not exists (select 1 from public.testkit_users where user_id = v_uid) then perform public.zz_test_join(null, false, null); end if;
  if p_flags is not null and jsonb_typeof(p_flags) = 'object' then
    for k, v in select * from jsonb_each(p_flags) loop
      if k !~ '^[a-z0-9_]{2,30}$' then raise exception 'invalid_flag'; end if;
      if jsonb_typeof(v) = 'null' then v_del := v_del || k; elsif jsonb_typeof(v) = 'boolean' then v_set := v_set || jsonb_build_object(k, v);
      else raise exception 'invalid_flag'; end if;
    end loop;
  end if;
  if p_offset_min is not null and abs(p_offset_min) > 60 * 24 * 14 then raise exception 'invalid_offset'; end if;
  update public.testkit_users t
     set flags = (t.flags || v_set) - v_del,
         clock_offset = case when p_offset_min is null then t.clock_offset else make_interval(mins => p_offset_min) end,
         updated_at = now()
   where not t.retired and (t.user_id = v_uid or exists (
     select 1 from public.group_members a join public.group_members b on b.group_id = a.group_id
      where a.user_id = t.user_id and b.user_id = v_uid));
  return public.zz_test_state();
end $$;

create or replace function public.zz_test_group_get(p_label text default 'Testgänget')
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce((select jsonb_build_object('label', g.label, 'group_id', g.group_id, 'code', g.code,
    'exists', exists (select 1 from public.groups x where x.id = g.group_id)) from public.testkit_groups g where g.label = p_label), '{}'::jsonb);
$$;

create or replace function public.zz_test_group_set(p_label text, p_group_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); v_code text;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then raise exception 'not_member'; end if;
  if not exists (select 1 from public.testkit_users t where t.user_id = v_uid and t.is_bot and not t.retired) then raise exception 'not_bot'; end if;
  select g.code into v_code from public.groups g where g.id = p_group_id;
  insert into public.testkit_groups (label, group_id, code) values (left(p_label, 40), p_group_id, v_code)
  on conflict (label) do update set group_id = excluded.group_id, code = excluded.code, updated_at = now();
  return public.zz_test_group_get(p_label);
end $$;

-- A new bot set (same labels, new gen) takes over: each OLD bot with this label leaves its groups through the normal
-- leave_group RPC (run as that bot), then it is marked retired. Only a registered bot can call it.
create or replace function public.zz_test_retire(p_label text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true); o record; g record; n int := 0;
begin
  if not exists (select 1 from public.testkit_users t where t.user_id = v_uid and t.is_bot and not t.retired) then raise exception 'not_bot'; end if;
  for o in select t.user_id from public.testkit_users t where t.is_bot and not t.retired and t.label = p_label and t.user_id <> v_uid loop
    perform set_config('request.jwt.claims', json_build_object('sub', o.user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', o.user_id::text, true);
    for g in select m.group_id from public.group_members m where m.user_id = o.user_id loop
      perform public.leave_group(g.group_id);
      n := n + 1;
    end loop;
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
    update public.testkit_users set retired = true, updated_at = now() where user_id = o.user_id;
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return jsonb_build_object('ok', true, 'left', n);
end $$;

-- Open a moment NOW in my group (no push rows). kind: vad | halvtid | bord | agent. Only questions that cannot
-- settle at once ("bars" / "skal_n" / "all_come" settle early when the gang already passed the line).
create or replace function public.zz_test_moment(p_group_id uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := public.olnu_uid(); v_now timestamptz := public.olnu_crew_now(); v_night timestamptz := public.olnu_night_of(public.olnu_crew_now());
  v_who uuid[]; v_slot int; v_q text; v_opts jsonb; r public.moment_rounds; v_bar text; v_barname text; v_agent uuid;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then raise exception 'not_member'; end if;
  if p_kind not in ('vad', 'halvtid', 'bord', 'agent') then raise exception 'invalid_kind'; end if;
  v_who := array(select m.user_id from public.group_members m where m.group_id = p_group_id
                   and not public.olnu_after_ghost(m.user_id, v_night) order by m.joined_at limit 12);
  if coalesce(array_length(v_who, 1), 0) < 2 then raise exception 'too_few'; end if;
  select coalesce(max(x.slot), 0) + 1 into v_slot from public.moment_rounds x where x.group_id = p_group_id and x.night = v_night and x.kind = p_kind;
  if p_kind = 'vad' then
    v_q := (array['first_home', 'last_home'])[1 + floor(random() * 2)::int];
    v_opts := case when v_q in ('first_home', 'last_home', 'first_out') then public.olnu_mom_faces(p_group_id, v_who)
      when v_q = 'bars' then '[{"v":"1"},{"v":"2"},{"v":"3+"}]'::jsonb when v_q = 'all_come' then '[{"v":"ja"},{"v":"nej"}]'::jsonb
      else '[{"v":"0_9"},{"v":"10_25"},{"v":"26"}]'::jsonb end;
    insert into public.moment_rounds (group_id, night, kind, slot, q_key, opts, who, meta, created_by, closes_at)
    values (p_group_id, v_night, 'vad', v_slot, v_q, v_opts, v_who, '{"test":1}'::jsonb, v_uid, v_now + interval '30 minutes') returning * into r;
  elsif p_kind = 'halvtid' then
    v_q := 'last_home_t';
    v_opts := case v_q when 'bars' then '[{"v":"1"},{"v":"2"},{"v":"3+"}]'::jsonb when 'skal_n' then '[{"v":"0_9"},{"v":"10_25"},{"v":"26"}]'::jsonb
      else '[{"v":"f01"},{"v":"01_02"},{"v":"e02"}]'::jsonb end;
    insert into public.moment_rounds (group_id, night, kind, slot, q_key, opts, who, meta, created_by, closes_at)
    values (p_group_id, v_night, 'halvtid', v_slot, v_q, v_opts, v_who, '{"test":1}'::jsonb, v_uid, v_now + interval '20 minutes') returning * into r;
  elsif p_kind = 'bord' then
    select c.bar_id, c.bar_name into v_bar, v_barname from public.checkins c where c.user_id = v_uid and c.expires_at > now();
    insert into public.moment_rounds (group_id, night, kind, slot, who, bar_id, bar_name, mission, meta, created_by, closes_at)
    values (p_group_id, v_night, 'bord', v_slot, v_who, coalesce(v_bar, 'n3472634175'), left(coalesce(v_barname, 'Pitchers'), 40),
            1 + floor(random() * 20)::int, '{"test":1}'::jsonb, v_uid, v_now + interval '45 minutes') returning * into r;
  else
    if array_length(v_who, 1) < 3 then raise exception 'too_few'; end if;
    select u into v_agent from unnest(v_who) u where u <> v_uid order by random() limit 1;
    insert into public.moment_rounds (group_id, night, kind, slot, who, mission, agent, meta, created_by, closes_at, reveal_at)
    values (p_group_id, v_night, 'agent', v_slot, v_who, 1 + floor(random() * 60)::int, v_agent, '{"test":1}'::jsonb, v_uid,
            v_now + interval '40 minutes', v_now + interval '25 minutes') returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'kind', r.kind, 'q', r.q_key, 'night', r.night);
end $$;

do $grants$
declare f text;
begin
  foreach f in array array['zz_test_join(text,boolean,text)', 'zz_test_state()', 'zz_test_set(jsonb,integer)', 'zz_test_group_get(text)',
    'zz_test_group_set(text,uuid)', 'zz_test_retire(text)', 'zz_test_moment(uuid,text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated, service_role';
  end loop;
end $grants$;
