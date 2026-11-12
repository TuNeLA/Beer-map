-- PintsNow: owner runs this ONE file in the Supabase SQL editor (part 2).
-- Contains 0252 (avatar unlock levels on the server) and 0253 (Gissa kvällen counts people).

-- ===== migrations/0252_avatar_tiers_owner.sql =====
-- 0252 👤 AVATAR v3 tiers, part 2 (agent feat, 2026-11-07). OWNER RUNS THIS (it replaces 3 existing functions; CREATE OR
-- REPLACE only, same signatures, no table change). Needs 0251.
--   olnu_avatar_lock_ok : a lock with "n" (v3) is open when facts.gf (grandfathered) is true.
--   olnu_avatar_facts   : + gf = the user is in avatar_grandfather.
--   olnu_avatar_clean   : checks olnu_avatar_locks() || olnu_avatar_locks3().
-- It first grandfathers everyone who saved an avatar up to now (so nobody who saved before this runs loses anything).
-- Rerun = no change.
insert into public.avatar_grandfather (user_id)
select a.user_id from public.avatars a
 where exists (select 1 from auth.users u where u.id = a.user_id)
on conflict (user_id) do nothing;

create or replace function public.olnu_avatar_lock_ok(p_lk jsonb, p_f jsonb)
returns boolean language plpgsql immutable set search_path to 'public' as $$
declare v_ok boolean := true; v_t text := coalesce(p_f->>'today', '01-01'); v_a text; v_b text; x jsonb;
begin
  if p_lk is null then return true; end if;
  if p_lk ? 'n' and coalesce((p_f->>'gf')::boolean, false) then return true; end if;   -- v3: grandfathered
  if (p_lk ? 'r' and coalesce((p_f->>'r')::int, 1) < (p_lk->>'r')::int)
     or (p_lk ? 'm' and not coalesce(p_f->'m', '[]'::jsonb) ? (p_lk->>'m'))
     or (p_lk ? 's' and coalesce((p_f->>'s')::int, 0) < (p_lk->>'s')::int)
     or (p_lk ? 'b' and coalesce((p_f->>'b')::int, 0) < (p_lk->>'b')::int)
     or (p_lk ? 't' and coalesce((p_f->>'t')::int, 0) < (p_lk->>'t')::int)
     or (p_lk ? 'e' and coalesce((p_f->>'e')::int, 0) < (p_lk->>'e')::int)
     or (p_lk ? 'g' and coalesce((p_f->>'g')::int, 0) < (p_lk->>'g')::int)
     or (p_lk ? 'k' and coalesce((p_f->>'k')::int, 0) < (p_lk->>'k')::int) then
    v_ok := false;
  end if;
  if v_ok and p_lk ? 'd' then
    v_a := substr(p_lk->>'d', 1, 5); v_b := substr(p_lk->>'d', 7, 5);
    v_ok := case when v_a <= v_b then v_t between v_a and v_b else v_t >= v_a or v_t <= v_b end;
  end if;
  if v_ok then return true; end if;
  if jsonb_typeof(p_lk->'o') = 'array' then
    for x in select * from jsonb_array_elements(p_lk->'o') loop
      if public.olnu_avatar_lock_ok(x, p_f) then return true; end if;
    end loop;
  end if;
  return false;
end; $$;

create or replace function public.olnu_avatar_facts(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_m int := 0; v_r int := 1; v_n int := 42; v_title text; v_next text; v_next_at int;
  v_s int := 0; v_b int := 0; v_t int := 0; v_e int := 0; v_g int := 0; v_k int := 0; v_md jsonb := '[]'::jsonb; v_gf boolean := false;
begin
  begin v_m := coalesce(public.olnu_meriter(p_uid), 0); exception when others then v_m := 0; end;
  begin
    select ro.idx, ro.n, ro.title, ro.next_title, ro.next_at into v_r, v_n, v_title, v_next, v_next_at from public.olnu_rank_of(v_m) ro;
  exception when others then v_r := 1; end;
  begin v_s := coalesce((public.olnu_helg_calc(p_uid, now())->>'best')::int, 0); exception when others then v_s := 0; end;
  begin select count(distinct mc.bar_id)::int into v_b from public.medal_checkins mc where mc.user_id = p_uid; exception when others then v_b := 0; end;
  begin select count(distinct an.town)::int into v_t from public.after_nights an where an.user_id = p_uid and an.town is not null; exception when others then v_t := 0; end;
  begin
    select count(*)::int into v_e from public.invite_people p join public.invites i on i.id = p.invite_id
     where p.user_id = p_uid and p.answer = 'yes' and i.creator <> p_uid and i.starts_at < now();
  exception when others then v_e := 0; end;
  begin
    select count(*)::int into v_g from public.group_members gm
     where gm.user_id = p_uid and not public.olnu_is_temp_group(gm.group_id);
  exception when others then v_g := 0; end;
  begin select count(*)::int into v_k from public.snap_photos sp where sp.user_id = p_uid and sp.kind = 'film'; exception when others then v_k := 0; end;
  begin select exists (select 1 from public.avatar_grandfather x where x.user_id = p_uid) into v_gf; exception when others then v_gf := false; end;
  select coalesce(jsonb_agg(um.medal order by um.earned_at desc), '[]'::jsonb) into v_md
    from public.user_medals um where um.user_id = p_uid;
  return jsonb_build_object('mer', v_m, 'r', coalesce(v_r, 1), 'n', coalesce(v_n, 42), 'title', v_title,
    'next_title', v_next, 'next_at', v_next_at, 's', v_s, 'b', v_b, 't', v_t, 'e', v_e, 'g', v_g, 'k', v_k, 'm', v_md,
    'gf', coalesce(v_gf, false), 'today', to_char(now() at time zone 'Europe/Stockholm', 'MM-DD'));
end; $$;

create or replace function public.olnu_avatar_clean(p_uid uuid, p_spec jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_max jsonb := public.olnu_avatar_max();
  v_locks jsonb := public.olnu_avatar_locks() || public.olnu_avatar_locks3();
  v_f jsonb := public.olnu_avatar_facts(p_uid);
  v_cur jsonb;
  v_out jsonb := jsonb_build_object('v', 2);
  k text; val jsonb; n int; lk jsonb; md jsonb := '[]'::jsonb; x jsonb;
begin
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' or octet_length(p_spec::text) > 1024 then
    raise exception 'invalid_avatar';
  end if;
  select a.spec into v_cur from public.avatars a where a.user_id = p_uid;
  for k, val in select * from jsonb_each(p_spec) loop
    if k = 'v' then continue; end if;
    if k = 'md' then
      if jsonb_typeof(val) <> 'array' or jsonb_array_length(val) > 6 then raise exception 'invalid_avatar'; end if;
      for x in select * from jsonb_array_elements(val) loop
        if jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 24 or (x #>> '{}') in ('het', 'medevac')
           or not (v_f->'m') ? (x #>> '{}') then raise exception 'invalid_avatar'; end if;
        if not md ? (x #>> '{}') then md := md || jsonb_build_array(x); end if;
      end loop;
      continue;
    end if;
    if not v_max ? k or jsonb_typeof(val) <> 'number' then raise exception 'invalid_avatar'; end if;
    n := (val #>> '{}')::numeric::int;
    if n::numeric <> (val #>> '{}')::numeric or n < 0 or n > (v_max->>k)::int then raise exception 'invalid_avatar'; end if;
    lk := v_locks->(k || ':' || n);
    if lk is not null and not public.olnu_avatar_lock_ok(lk, v_f)
       and not (case when jsonb_typeof(v_cur->k) = 'number' then (v_cur->>k)::numeric = n else false end) then
      raise exception 'locked';
    end if;
    v_out := v_out || jsonb_build_object(k, n);
  end loop;
  if jsonb_array_length(md) > 0 then v_out := v_out || jsonb_build_object('md', md); end if;
  return v_out;
end; $$;

revoke all on function public.olnu_avatar_lock_ok(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.olnu_avatar_facts(uuid) from public, anon, authenticated;
revoke all on function public.olnu_avatar_clean(uuid, jsonb) from public, anon, authenticated;


-- ===== migrations/0253_guess_people_owner.sql =====
-- 0253 🎯 Gissa kvällen → people, not beers (agent feat, 2026-11-07). OWNER RUNS THIS (it replaces 1 existing function).
-- Store-safe: the old facit counted beers logged in town (a drink count as a contest). Now the facit is the number of
-- different people who were out in town (2 mil runt) that night: a pin, a drink or a check-in in drink_log, test users
-- not counted. Same signature, so game_poll / olnu_g_oracle / guess_night keep working unchanged.
-- guess_night_kind() is new: the app shows Gissa kvällen ONLY when it returns 'folk' (before this runs the app hides
-- the game, so nobody sees a beer count). Rerun = no change.
create or replace function public.olnu_g_real(p_night timestamptz, p_lat float8, p_lng float8)
returns int language sql stable security definer set search_path = public as $$
  select count(distinct d.user_id)::int from public.drink_log d
   where d.night = p_night and not d.undone
     and d.lat between p_lat - 0.19 and p_lat + 0.19
     and d.lng between p_lng - 0.56 and p_lng + 0.56
     and public.olnu_dist_m(p_lat, p_lng, d.lat, d.lng) <= 20000
     and not public.olnu_is_test_user(d.user_id);
$$;
revoke all on function public.olnu_g_real(timestamptz, float8, float8) from public, anon, authenticated;

create or replace function public.guess_night_kind()
returns text language sql immutable set search_path = public as $$ select 'folk'::text; $$;
do $$ begin
  execute 'revoke all on function public.guess_night_kind() from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function public.guess_night_kind() from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant execute on function public.guess_night_kind() to authenticated'; end if;
end $$;

select 'KLART - del 2 kördes' as status;
