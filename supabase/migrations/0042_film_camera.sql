-- 0042 v27 ENGÅNGSKAMERAN RPCs. Needs 0040. Push: notify-group {event:"film", group_id, night}.
-- 10 shots per member per group per night (night = 05:00-05:00 Europe/Stockholm), max 60 per group per night
-- (same as the 0028 chat photo cap). Every shot is hidden from everyone, also from the one who took it, until
-- 10:00 the morning the night ends (olnu_gang_reveal). Then the roll is developed: film_roll lists it, film_photo
-- gives the bytes, members react (one emoji per member per photo). The first film_poll() by a member after 10:00
-- claims the roll's push (film_rolls) and that member's app sends notify-group {event:"film"}.
-- SECURITY DEFINER, search_path public, olnu_uid(), EXECUTE for authenticated only. Rows are never removed.

create or replace function public.olnu_film_emojis()
returns text[] language sql immutable security definer set search_path = public as $$
  select array['🔥', '😂', '😍', '🍻', '💀', '👑', '🫡', '🥴'];
$$;

-- One developed photo with its reactions for p_uid.
create or replace function public.olnu_film_photo_json(sp public.snap_photos, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', sp.id, 'k', public.olnu_gang_k(sp.group_id, sp.user_id),
    'name', coalesce(public.olnu_gang_name(sp.group_id, sp.user_id), '?'), 'is_me', sp.user_id = p_uid,
    'at', sp.created_at, 'w', sp.w, 'h', sp.h,
    'reacts', coalesce((select jsonb_agg(jsonb_build_object('e', x.emoji, 'n', x.n) order by x.n desc, x.emoji)
                          from (select r.emoji, count(*)::int as n from public.film_reacts r
                                 where r.photo_id = sp.id and r.active group by r.emoji) x), '[]'::jsonb),
    'n', (select count(*) from public.film_reacts r where r.photo_id = sp.id and r.active)::int,
    'my', (select r.emoji from public.film_reacts r where r.photo_id = sp.id and r.user_id = p_uid and r.active));
$$;

-- film_shoot(p_group_id, p_b64, p_w, p_h) -> jsonb {left, mine, group_n, develop_at, night}. No photo id: nobody
-- sees the shot before 10:00. Errors: not_member, invalid_photo, slow_down (1 per 3 s), film_empty (10 used),
-- film_full (60 per group per night).
create or replace function public.film_shoot(p_group_id uuid, p_b64 text, p_w int default 0, p_h int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
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
end; $$;

-- film_state(p_group_id) -> jsonb {now, night, develop_at, mine, left, max, group_n, group_max, shooters,
--   keeps, rolls:[{night, evening, develop_at, n, alive}] (developed, with photos, newest first, max 10)}.
create or replace function public.film_state(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object(
    'now', now(), 'night', v_night, 'develop_at', public.olnu_gang_reveal(v_night),
    'mine', (select count(*) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film'
              and sp.night = v_night and sp.user_id = v_uid)::int,
    'left', greatest(0, 10 - (select count(*) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film'
              and sp.night = v_night and sp.user_id = v_uid))::int,
    'max', 10,
    'group_n', (select count(*) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night)::int,
    'group_max', 60,
    'shooters', (select count(distinct sp.user_id) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night)::int,
    'keeps', public.olnu_group_keeps(p_group_id),
    'rolls', coalesce((select jsonb_agg(jsonb_build_object('night', x.night, 'evening', public.olnu_evening(x.night),
                 'develop_at', x.rev, 'n', x.n, 'alive', x.alive) order by x.night desc)
               from (select sp.night, min(sp.reveal_at) as rev, count(*)::int as n,
                            count(*) filter (where sp.bytes is not null and sp.expires_at > now())::int as alive
                       from public.snap_photos sp
                      where sp.group_id = p_group_id and sp.kind = 'film' and sp.reveal_at <= now()
                        and sp.created_at > now() - interval '32 days'
                      group by sp.night order by sp.night desc limit 10) x), '[]'::jsonb));
end; $$;

-- film_roll(p_group_id, p_night default null = the newest developed roll) -> jsonb
--   {night, evening, develop_at, developed, n, gone, photos:[{id, k, name, is_me, at, w, h, reacts[{e,n}], n, my}]}.
--   Before 10:00: developed = false and no photos. Error: not_member.
create or replace function public.film_roll(p_group_id uuid, p_night timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := p_night;
  v_rev   timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if v_night is null then
    select max(sp.night) into v_night from public.snap_photos sp
     where sp.group_id = p_group_id and sp.kind = 'film' and sp.reveal_at <= now() and sp.created_at > now() - interval '32 days';
  end if;
  if v_night is null then
    return jsonb_build_object('night', null, 'developed', false, 'n', 0, 'gone', 0, 'photos', '[]'::jsonb);
  end if;
  v_rev := public.olnu_gang_reveal(v_night);
  if v_rev > now() then
    return jsonb_build_object('night', v_night, 'evening', public.olnu_evening(v_night), 'develop_at', v_rev, 'developed', false,
      'n', (select count(*) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night)::int,
      'gone', 0, 'photos', '[]'::jsonb);
  end if;
  return jsonb_build_object('night', v_night, 'evening', public.olnu_evening(v_night), 'develop_at', v_rev, 'developed', true,
    'n', (select count(*) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night)::int,
    'gone', (select count(*) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night
              and not (sp.bytes is not null and sp.expires_at > now()))::int,
    'expires_at', (select max(sp.expires_at) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night),
    'photos', coalesce((select jsonb_agg(public.olnu_film_photo_json(sp, v_uid) order by sp.created_at, sp.id)
                          from public.snap_photos sp
                         where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night
                           and sp.bytes is not null and sp.expires_at > now()
                           and exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = sp.user_id)), '[]'::jsonb));
end; $$;

-- film_photo(p_photo_id) -> jsonb {id, mime, w, h, b64}. Developed + alive + member. Errors: photo_not_found, not_member.
create or replace function public.film_photo(p_photo_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.snap_photos;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.snap_photos sp
   where sp.id = p_photo_id and sp.kind = 'film' and sp.reveal_at <= now() and sp.bytes is not null and sp.expires_at > now();
  if not found then raise exception 'photo_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object('id', v_row.id, 'mime', v_row.mime, 'w', v_row.w, 'h', v_row.h,
    'b64', replace(encode(v_row.bytes, 'base64'), E'\n', ''));
end; $$;

-- film_react(p_photo_id, p_emoji) -> photo json. The same emoji again takes it back; another emoji replaces it.
-- Errors: photo_not_found, not_member, invalid_emoji, slow_down (60 per minute).
create or replace function public.film_react(p_photo_id bigint, p_emoji text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.snap_photos;
  v_cur public.film_reacts;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.snap_photos sp
   where sp.id = p_photo_id and sp.kind = 'film' and sp.reveal_at <= now() and sp.bytes is not null and sp.expires_at > now();
  if not found then raise exception 'photo_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if p_emoji is null or not (p_emoji = any (public.olnu_film_emojis())) then raise exception 'invalid_emoji'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_film_r:' || v_uid::text, 0));
  if (select count(*) from public.film_reacts r where r.user_id = v_uid and r.updated_at > now() - interval '1 minute') >= 60 then
    raise exception 'slow_down';
  end if;
  select * into v_cur from public.film_reacts r where r.photo_id = p_photo_id and r.user_id = v_uid;
  if found and v_cur.active and v_cur.emoji = p_emoji then
    update public.film_reacts r set active = false, updated_at = now() where r.photo_id = p_photo_id and r.user_id = v_uid;
  else
    insert into public.film_reacts as r (photo_id, user_id, emoji, active, updated_at)
    values (p_photo_id, v_uid, p_emoji, true, now())
    on conflict (photo_id, user_id) do update set emoji = p_emoji, active = true, updated_at = now();
  end if;
  return public.olnu_film_photo_json(v_row, v_uid);
end; $$;

-- film_poll() -> jsonb {v, now, night, develop_at, groups:[{group_id, mine, left, group_n}],
--   rolls:[{group_id, group_name, night, develop_at, n, push_mine}] (rolls developed in the last 20 h, with photos)}.
-- push_mine = this call claimed the roll's "Filmen är framkallad!" push (film_rolls): the client sends
-- notify-group {event:"film", group_id, night}.
create or replace function public.film_poll()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  r       record;
  v_rolls jsonb := '[]'::jsonb;
  v_mine  boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  for r in select sp.group_id, sp.night, min(sp.reveal_at) as rev, count(*)::int as n
             from public.snap_photos sp
             join public.group_members m on m.group_id = sp.group_id and m.user_id = v_uid
            where sp.kind = 'film' and sp.reveal_at <= now() and sp.reveal_at > now() - interval '20 hours'
            group by sp.group_id, sp.night loop
    v_mine := false;
    insert into public.film_rolls (group_id, night, claimed_by, claimed_at)
    values (r.group_id, r.night, v_uid, now())
    on conflict (group_id, night) do nothing;
    if found then v_mine := true; end if;
    if not v_mine then
      v_mine := exists (select 1 from public.film_rolls f where f.group_id = r.group_id and f.night = r.night
                         and f.claimed_by = v_uid and not f.notified and f.claimed_at > now() - interval '10 minutes');
    end if;
    v_rolls := v_rolls || jsonb_build_array(jsonb_build_object('group_id', r.group_id,
      'group_name', (select g.name from public.groups g where g.id = r.group_id),
      'night', r.night, 'develop_at', r.rev, 'n', r.n, 'push_mine', v_mine));
  end loop;
  return jsonb_build_object('v', 1, 'now', now(), 'night', v_night, 'develop_at', public.olnu_gang_reveal(v_night),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('group_id', m.group_id,
        'mine', (select count(*) from public.snap_photos sp where sp.group_id = m.group_id and sp.kind = 'film' and sp.night = v_night and sp.user_id = v_uid)::int,
        'left', greatest(0, 10 - (select count(*) from public.snap_photos sp where sp.group_id = m.group_id and sp.kind = 'film' and sp.night = v_night and sp.user_id = v_uid))::int,
        'group_n', (select count(*) from public.snap_photos sp where sp.group_id = m.group_id and sp.kind = 'film' and sp.night = v_night)::int))
        from public.group_members m where m.user_id = v_uid), '[]'::jsonb),
    'rolls', v_rolls);
end; $$;

do $$
declare
  v_h text := 'public.olnu_film_emojis(), public.olnu_film_photo_json(public.snap_photos, uuid)';
  v_r text := 'public.film_shoot(uuid, text, integer, integer), public.film_state(uuid), public.film_roll(uuid, timestamptz), '
    || 'public.film_photo(bigint), public.film_react(bigint, text), public.film_poll()';
begin
  execute 'revoke all on function ' || v_h || ' from public';
  execute 'revoke all on function ' || v_r || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function ' || v_h || ' from anon';
    execute 'revoke all on function ' || v_r || ' from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function ' || v_h || ' from authenticated';
    execute 'grant execute on function ' || v_r || ' to authenticated';
  end if;
end $$;
