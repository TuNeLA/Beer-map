-- 0093 review2: abuse and storage limits for the new features. Additive (same signatures, same return shapes,
-- one new error code "slow_down" that every client already shows as a generic message). Safe to run again.
--  1. create_group: max 6 new groups per user per 24 h. Without it one anonymous account can make hundreds of
--     groups, and every group gives it a new film budget (10 shots x 160 KB, kept 7-30 days) and more pushes.
--  2. film_shoot: max 30 film shots per user per night across all groups (was 10 per group, no total).
--  3. find_request: max 3 requests from one person to the same person per 30 min (each one is a push).
--  4. friend_request: a request that is re-opened less than 24 h after the last change (cancel + ask again)
--     does not push again (notified stays true). Before, cancel/ask loops gave a push every 20 s to the target.
--  5. owner_db_stats: search_path "public, pg_catalog" -> "pg_catalog, public" (built-ins first).

create index if not exists groups_created_by_idx on public.groups (created_by, created_at);

-- 1 ---------------------------------------------------------------------------
create or replace function public.create_group(p_name text, p_display_name text)
returns json language plpgsql security definer set search_path = public as $function$
declare
  v_uid      uuid := public.olnu_uid();
  v_name     text := btrim(coalesce(p_name, ''));
  v_display  text := public.olnu_clean_display_name(p_display_name);
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code     text;
  v_id       uuid;
  v_try      int := 0;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'invalid_name';
  end if;
  -- review2: rate limit (serialised per user so parallel calls cannot pass it together)
  perform pg_advisory_xact_lock(hashtextextended('olnu_mkgroup:' || coalesce(v_uid::text, ''), 0));
  if (select count(*) from public.groups g where g.created_by = v_uid and g.created_at > now() - interval '24 hours') >= 6 then
    raise exception 'slow_down';
  end if;

  loop
    v_try := v_try + 1;
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * 32)::int, 1);
    end loop;

    insert into public.groups (name, code, created_by)
    values (v_name, v_code, v_uid)
    on conflict (code) do nothing
    returning groups.id into v_id;

    exit when v_id is not null;
    if v_try >= 20 then
      raise exception 'code_generation_failed';
    end if;
  end loop;

  insert into public.group_members (group_id, user_id, display_name)
  values (v_id, v_uid, v_display);

  return json_build_object('id', v_id, 'name', v_name, 'code', v_code);
end;
$function$;

-- 2 ---------------------------------------------------------------------------
create or replace function public.film_shoot(p_group_id uuid, p_b64 text, p_w integer default 0, p_h integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_rev   timestamptz := public.olnu_gang_reveal(public.olnu_night_of(now()));
  v_ph    record;
  v_n     int;
  v_g     int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select * into v_ph from public.olnu_snap_decode(p_b64, p_w, p_h);
  perform pg_advisory_xact_lock(hashtextextended('olnu_film:' || v_uid::text, 0));
  if exists (select 1 from public.snap_photos sp where sp.user_id = v_uid and sp.kind = 'film'
              and sp.created_at > now() - interval '3 seconds') then
    raise exception 'slow_down';
  end if;
  -- review2: one budget per person per night, across all groups (snap_photos_user_idx covers it)
  if (select count(*) from public.snap_photos sp where sp.user_id = v_uid and sp.kind = 'film'
        and sp.created_at > now() - interval '20 hours' and sp.night = v_night) >= 30 then
    raise exception 'film_empty';
  end if;
  select count(*)::int into v_n from public.snap_photos sp
   where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night and sp.user_id = v_uid;
  if v_n >= 10 then raise exception 'film_empty'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_film_g:' || p_group_id::text, 0));
  select count(*)::int into v_g from public.snap_photos sp
   where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night;
  if v_g >= 60 then raise exception 'film_full'; end if;
  perform public.olnu_snap_sweep();
  insert into public.snap_photos (kind, group_id, user_id, ref_id, night, mime, bytes, size, w, h, reveal_at, expires_at)
  values ('film', p_group_id, v_uid, null, v_night, v_ph.o_mime, v_ph.o_bytes, octet_length(v_ph.o_bytes), p_w, p_h,
          v_rev, public.olnu_snap_exp('film', p_group_id, v_night, v_rev));
  return jsonb_build_object('left', 9 - v_n, 'mine', v_n + 1, 'group_n', v_g + 1, 'develop_at', v_rev, 'night', v_night);
end; $function$;

-- 3 ---------------------------------------------------------------------------
create or replace function public.find_request(p_key text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_uid uuid := public.olnu_uid();
  t record; r public.find_reqs; v_auto boolean; v_end timestamptz := public.olnu_next_expiry();
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  select * into t from public.olnu_find_resolve(p_key, v_uid);
  perform pg_advisory_xact_lock(hashtextextended('olnu_find:' || least(v_uid, t.uid)::text || greatest(v_uid, t.uid)::text, 0));
  r := public.olnu_find_live(v_uid, t.uid);
  if r.id is not null and r.status = 'pending' and r.to_uid = v_uid then
    update public.find_reqs x set status = 'accepted', answered_at = now(), until = least(now() + interval '30 minutes', v_end)
     where x.id = r.id returning * into r;
    return public.olnu_find_req_json(r, v_uid) || jsonb_build_object('auto', false, 'allowed', true);
  end if;
  if r.id is not null then
    return public.olnu_find_req_json(r, v_uid) || jsonb_build_object('auto', r.status = 'auto', 'allowed', public.olnu_find_allowed(v_uid, t.uid));
  end if;
  if exists (select 1 from public.find_reqs x where x.from_uid = v_uid and x.created_at > now() - interval '15 seconds')
     or (select count(*) from public.find_reqs x where x.from_uid = v_uid and x.created_at > now() - interval '12 hours') >= 60
     -- review2: the same target at most 3 times per 30 min (cancel + ask again = a push each time)
     or (select count(*) from public.find_reqs x where x.from_uid = v_uid and x.to_uid = t.uid
          and x.created_at > now() - interval '30 minutes') >= 3 then
    raise exception 'slow_down';
  end if;
  v_auto := exists (select 1 from public.find_share s where s.user_id = t.uid and s.until > now()
                     and ((s.friends and public.olnu_are_friends(v_uid, t.uid)) or (s.groups and public.olnu_share_group(v_uid, t.uid))));
  insert into public.find_reqs (from_uid, to_uid, group_id, friendship_id, status, until, answered_at)
  values (v_uid, t.uid, t.group_id, t.friendship_id, case when v_auto then 'auto' else 'pending' end,
          case when v_auto then least(now() + interval '30 minutes', v_end) end, case when v_auto then now() end)
  returning * into r;
  return public.olnu_find_req_json(r, v_uid) || jsonb_build_object('auto', v_auto, 'allowed', public.olnu_find_allowed(v_uid, t.uid));
end; $function$;

-- 4 ---------------------------------------------------------------------------
create or replace function public.friend_request(p_code text default null, p_group_id uuid default null,
                                                 p_k text default null, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_t uuid; v_via text := 'code';
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  f public.friendships;
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  if p_group_id is not null then
    v_via := 'group';
    if not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid) then
      raise exception 'not_member';
    end if;
    select gm.user_id into v_t from public.group_members gm
     where gm.group_id = p_group_id
       and (public.olnu_chief_k(p_group_id, gm.user_id) = btrim(coalesce(p_k, '')));
    if v_t is null then raise exception 'invalid_member'; end if;
  else
    select c.user_id into v_t from public.friend_codes c where c.code = v_code;
    if v_t is null then raise exception 'friend_not_found'; end if;
  end if;
  if v_t = v_uid then raise exception 'own_code'; end if;

  perform pg_advisory_xact_lock(hashtextextended('olnu_friend:' || least(v_uid, v_t)::text || greatest(v_uid, v_t)::text, 0));
  select * into f from public.friendships x
   where least(x.a, x.b) = least(v_uid, v_t) and greatest(x.a, x.b) = greatest(v_uid, v_t);

  if f.id is not null and f.status = 'accepted' then
    return jsonb_build_object('id', f.id, 'status', 'accepted', 'name', public.olnu_friend_name(v_t), 'already', true, 'auto', false);
  end if;
  if f.id is not null and f.status = 'pending' and f.requester = v_uid then
    return jsonb_build_object('id', f.id, 'status', 'pending', 'name', public.olnu_friend_name(v_t), 'already', true, 'auto', false);
  end if;
  if (select count(*) from public.friendships x where (x.a = v_uid or x.b = v_uid) and x.status = 'accepted') >= 300 then
    raise exception 'friend_limit';
  end if;
  if f.id is not null and f.status = 'pending' then
    update public.friendships x set status = 'accepted', accepted_at = now(), updated_at = now()
     where x.id = f.id returning * into f;
    return jsonb_build_object('id', f.id, 'status', 'accepted', 'name', public.olnu_friend_name(v_t), 'already', false, 'auto', true);
  end if;
  if f.id is not null and f.status = 'declined' and f.requester = v_uid and f.updated_at > now() - interval '24 hours' then
    return jsonb_build_object('id', f.id, 'status', 'pending', 'name', public.olnu_friend_name(v_t), 'already', true, 'auto', false);
  end if;
  if (select count(*) from public.friendships x where x.requester = v_uid and x.updated_at > now() - interval '1 hour'
        and x.status in ('pending', 'cancelled', 'declined')) >= 30 then
    raise exception 'slow_down';
  end if;
  if f.id is not null then
    -- review2: re-opened within 24 h of the last change = no second push (notify-group claims notified = false)
    update public.friendships x set status = 'pending', requester = v_uid, via = v_via,
           notified = (x.updated_at > now() - interval '24 hours'), updated_at = now(),
           accepted_at = null, ended_by = null
     where x.id = f.id returning * into f;
  else
    insert into public.friendships (a, b, requester, status, via)
    values (least(v_uid, v_t), greatest(v_uid, v_t), v_uid, 'pending', v_via) returning * into f;
  end if;
  return jsonb_build_object('id', f.id, 'status', 'pending', 'name', public.olnu_friend_name(v_t), 'already', false, 'auto', false);
end; $function$;

-- 5 ---------------------------------------------------------------------------
alter function public.owner_db_stats(text) set search_path = pg_catalog, public;

-- Grants (create or replace keeps them; repeated so a fresh database matches)
revoke all on function public.create_group(text, text) from public;
revoke all on function public.film_shoot(uuid, text, integer, integer) from public;
revoke all on function public.find_request(text, text) from public;
revoke all on function public.friend_request(text, uuid, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.create_group(text, text), public.film_shoot(uuid, text, integer, integer), '
         || 'public.find_request(text, text), public.friend_request(text, uuid, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.create_group(text, text), public.film_shoot(uuid, text, integer, integer), '
         || 'public.find_request(text, text), public.friend_request(text, uuid, text, text) to authenticated';
  end if;
end $$;
