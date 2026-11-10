-- UNDO for the 11 Nov early run (sqlprep). EMERGENCY ONLY. It puts back the LIVE text (11 Nov 2026, before tonight) of every
-- old function that tonight's files changed. New tables, columns and new functions stay (unused). No row is removed.
-- After this, Bara vänner, the block filters (0403/0431) and the sec fixes (0430) are OFF again. Ride stays off with ride_flags off.
CREATE OR REPLACE FUNCTION public.bar_photos(p_bar_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_g jsonb; v_p jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_bar_id is null or char_length(p_bar_id) > 120 then raise exception 'invalid_bar'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', public.olnu_bp_key(x.id), 'kind', x.kind, 'w', x.w, 'h', x.h, 'at', x.taken_at,
           'by', (select m.display_name from public.group_members m where m.group_id = x.group_id and m.user_id = x.user_id),
           'group_name', (select g.name from public.groups g where g.id = x.group_id),
           'is_me', x.user_id = v_uid,
           'shared', x.pub,
           'can_share', x.user_id = v_uid and x.hidden_by is distinct from 'owner',
           'public_until', case when x.pub then x.public_until end)
         order by x.taken_at desc), '[]'::jsonb)
    into v_g
    from (select p.id, p.kind, p.w, p.h, p.taken_at, p.group_id, p.user_id, p.hidden_by, p.public_until,
                 public.olnu_bp_pub(p) as pub
            from public.bar_photos p
           where p.bar_id = p_bar_id and p.taken_at > now() - interval '8 days'
             and exists (select 1 from public.group_members m where m.group_id = p.group_id and m.user_id = v_uid)
             and public.olnu_bp_alive(p)
           order by p.taken_at desc limit 24) x;
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', public.olnu_bp_key(x.id), 'w', x.w, 'h', x.h, 'at', x.taken_at, 'is_me', x.user_id = v_uid,
           'public_until', x.public_until)
         order by x.public_at desc), '[]'::jsonb)
    into v_p
    from (select p.id, p.w, p.h, p.taken_at, p.user_id, p.public_until, p.public_at
            from public.bar_photos p
           where p.bar_id = p_bar_id and p.public_until > now() and p.hidden_at is null and p.pub_bytes is not null
             and not exists (select 1 from public.bar_photo_reports r where r.bp_id = p.id and r.user_id = v_uid)
             and not (exists (select 1 from public.group_members m where m.group_id = p.group_id and m.user_id = v_uid)
                      and public.olnu_bp_alive(p) and p.taken_at > now() - interval '8 days')
           order by p.public_at desc limit 24) x;
  return jsonb_build_object('v', 1, 'now', now(), 'bar_id', p_bar_id, 'group', v_g, 'public', v_p);
end; $function$

;

CREATE OR REPLACE FUNCTION public.film_photo(p_photo_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end; $function$

;

CREATE OR REPLACE FUNCTION public.film_report(p_photo_id bigint, p_reason text DEFAULT 'annat'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.snap_photos;
  v_reason text := case when p_reason in ('hat', 'sex', 'hot', 'spam', 'minor', 'drog', 'annat') then p_reason else 'annat' end;
  v_n int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.snap_photos sp where sp.id = p_photo_id and sp.kind = 'film' and sp.reveal_at <= now();
  if not found then raise exception 'photo_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_film_rep:' || v_uid::text, 0));
  if (select count(*) from public.film_reports r where r.user_id = v_uid and r.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'slow_down';
  end if;
  insert into public.film_reports (photo_id, user_id, reason) values (p_photo_id, v_uid, v_reason) on conflict (photo_id, user_id) do nothing;
  select count(distinct r.user_id) into v_n from public.film_reports r where r.photo_id = p_photo_id and r.user_id is distinct from v_row.user_id;
  if v_n >= 2 then
    update public.snap_photos sp set bytes = null, expires_at = least(sp.expires_at, now()) where sp.id = p_photo_id;
  end if;
  return jsonb_build_object('ok', true, 'id', p_photo_id, 'hidden_all', v_n >= 2);
end; $function$

;

CREATE OR REPLACE FUNCTION public.film_roll(p_group_id uuid, p_night timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_rev := coalesce((select min(sp.reveal_at) from public.snap_photos sp
                      where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_night),
                    public.olnu_gang_reveal(v_night));
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
end; $function$

;

CREATE OR REPLACE FUNCTION public.film_story(p_group_id uuid, p_night date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_tz constant text := 'Europe/Stockholm';
  v_cur timestamptz := public.olnu_night_of(now());
  v_end timestamptz;
  v_rev timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if p_night is null then
    v_end := ((v_cur at time zone v_tz) - interval '1 day') at time zone v_tz;
  else
    v_end := ((p_night + 1)::timestamp + time '05:00') at time zone v_tz;
    if v_end > v_cur then v_end := v_cur; end if;
  end if;
  v_rev := public.olnu_gang_reveal(v_end);
  return jsonb_build_object('night', v_end, 'evening', public.olnu_evening(v_end), 'develop_at', v_rev,
    'developed', v_rev <= now(),
    'n', (select count(*) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_end)::int,
    'skal_n', (select count(*) from public.skal_hours h where h.group_id = p_group_id and h.night = v_end)::int,
    'camera_photos', case when v_rev > now() then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'by', x.display_name, 'at', x.created_at, 'w', x.w, 'h', x.h,
               'reacts', x.n, 'caption', null, 'camera', true) order by x.n desc, x.created_at)
        from (select sp.id, sp.created_at, sp.w, sp.h, m.display_name,
                     (select count(*) from public.film_reacts r where r.photo_id = sp.id and r.active)::int as n
                from public.snap_photos sp
                join public.group_members m on m.group_id = p_group_id and m.user_id = sp.user_id
               where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = v_end
                 and sp.bytes is not null and sp.expires_at > now()
               order by 6 desc, sp.created_at limit 4) x), '[]'::jsonb) end);
end; $function$

;

CREATE OR REPLACE FUNCTION public.friend_list(p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  with fr as (
    select public.olnu_friend_other(f, v_uid) as uid, f.id as fid, f.via
      from public.friendships f
     where (f.a = v_uid or f.b = v_uid) and f.status = 'accepted'
  ), gm as (
    select gm2.user_id as uid, gm.group_id
      from public.group_members gm
      join public.group_members gm2 on gm2.group_id = gm.group_id
     where gm.user_id = v_uid and gm2.user_id <> v_uid
  ), u as (
    select x.uid from (select uid from fr union select uid from gm) x where x.uid is not null and x.uid <> v_uid limit 400
  ), rows as (
    select u.uid,
           (select fr.fid from fr where fr.uid = u.uid limit 1) as fid,
           (select fr.via from fr where fr.uid = u.uid limit 1) as via,
           (select gm.group_id from gm join public.groups g on g.id = gm.group_id where gm.uid = u.uid order by g.name, g.id limit 1) as g1,
           coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name)
                       from gm join public.groups g on g.id = gm.group_id where gm.uid = u.uid), '[]'::jsonb) as groups,
           public.olnu_friend_name(u.uid) as nm,
           po.is_out, po.town
      from u left join lateral public.olnu_friend_out(u.uid) po on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', public.olnu_inv_key(v_uid, r.uid),
           'name', coalesce(r.nm, '?'), 'home_town', public.olnu_home_town(r.uid),
           'out', coalesce(r.is_out, false), 'town', r.town,
           'friend_id', r.fid, 'friend', r.fid is not null, 'via', r.via,
           'groups', r.groups,
           'find_key', case when r.fid is not null then 'f' || r.fid
                            when r.g1 is not null then 'g' || r.g1 || ':' || public.olnu_chief_k(r.g1, r.uid) end,
           'add', case when r.fid is null and r.g1 is not null
                       then jsonb_build_object('g', r.g1, 'k', public.olnu_chief_k(r.g1, r.uid)) end)
         order by coalesce(r.is_out, false) desc, lower(coalesce(r.nm, '~'))), '[]'::jsonb)
    into v from rows r;
  return jsonb_build_object('v', 1, 'people', v,
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
                 'n', (select count(*) from public.group_members m2 where m2.group_id = g.id)) order by g.name)
              from public.group_members m join public.groups g on g.id = m.group_id where m.user_id = v_uid), '[]'::jsonb));
end; $function$

;

CREATE OR REPLACE FUNCTION public.friend_request(p_code text DEFAULT NULL::text, p_group_id uuid DEFAULT NULL::uuid, p_k text DEFAULT NULL::text, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    update public.friendships x set status = 'pending', requester = v_uid, via = v_via,
           notified = (x.updated_at > now() - interval '24 hours'), updated_at = now(),
           accepted_at = null, ended_by = null
     where x.id = f.id returning * into f;
  else
    insert into public.friendships (a, b, requester, status, via)
    values (least(v_uid, v_t), greatest(v_uid, v_t), v_uid, 'pending', v_via) returning * into f;
  end if;
  return jsonb_build_object('id', f.id, 'status', 'pending', 'name', public.olnu_friend_name(v_t), 'already', false, 'auto', false);
end; $function$

;

CREATE OR REPLACE FUNCTION public.gang_group(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_last timestamptz := public.olnu_gang_last_night();
  p public.gang_polls;
  r public.gang_mt_rounds;
  b public.gang_brunches;
  v_round jsonb := null; v_hist jsonb; v_poll jsonb := null; v_brunch jsonb := null;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  for p in select * from public.gang_polls x where x.group_id = p_group_id and x.ended_at is null and x.ends_at <= now() loop
    perform public.olnu_gang_rl('poll:' || p_group_id::text);
    perform public.olnu_gang_poll_finish(p.id, v_uid);
  end loop;
  select * into r from public.gang_mt_rounds x where x.group_id = p_group_id and x.night = v_night order by x.id desc limit 1;
  if found then v_round := public.olnu_gang_mt_json(r, v_uid); end if;
  select coalesce(jsonb_agg(public.olnu_gang_mt_json(x, v_uid) order by x.id desc), '[]'::jsonb) into v_hist
    from (select * from public.gang_mt_rounds y where y.group_id = p_group_id and y.night = v_night order by y.id desc limit 20) x;
  select * into p from public.gang_polls x
   where x.group_id = p_group_id and (x.ended_at is null or x.ended_at > now() - interval '60 minutes')
   order by x.id desc limit 1;
  if found then v_poll := public.olnu_gang_poll_json(p, v_uid); end if;
  select * into b from public.gang_brunches x where x.group_id = p_group_id and not x.closed and x.expires_at > now()
   order by x.id desc limit 1;
  if found then v_brunch := public.olnu_gang_brunch_json(b, v_uid); end if;
  return jsonb_build_object(
    'server_time', now(), 'night', v_night, 'last_night', v_last, 'hour', public.olnu_gang_hour(),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_gang_k(p_group_id, m.user_id),
                  'name', m.display_name, 'is_me', m.user_id = v_uid) order by m.user_id <> v_uid, m.display_name), '[]'::jsonb)
                  from public.group_members m where m.group_id = p_group_id),
    'mt', jsonb_build_object('round', v_round, 'history', v_hist),
    'poll', v_poll, 'brunch', v_brunch,
    'quotes', jsonb_build_object(
      'pending', (select count(*) from public.gang_quotes q where q.group_id = p_group_id and not q.hidden and q.reveal_at > now())::int,
      'next_reveal', (select min(q.reveal_at) from public.gang_quotes q where q.group_id = p_group_id and not q.hidden and q.reveal_at > now()),
      'yesterday', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'who', q.who, 'body', q.body, 'at', q.created_at) order by q.id), '[]'::jsonb)
                      from public.gang_quotes q where q.group_id = p_group_id and not q.hidden and q.night = v_last and q.reveal_at <= now())),
    'debts', public.olnu_gang_debts_json(p_group_id, v_uid));
end; $function$

;

CREATE OR REPLACE FUNCTION public.gang_paper(p_group_id uuid, p_night timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := coalesce(p_night, public.olnu_gang_last_night());
  v_mem jsonb; v_q jsonb; v_mt jsonb; v_take jsonb; v_town text; v_out int; v_crawl boolean := false;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if v_night > public.olnu_gang_last_night() then v_night := public.olnu_gang_last_night(); end if;
  with mem as (
    select m.user_id, m.display_name from public.group_members m where m.group_id = p_group_id
  ), mn as (
    select n.user_id, (n.beers + n.others) > 0 as out, n.first_at, n.home from public.medal_nights n
     where n.night = v_night and n.user_id in (select user_id from mem)
  ), an as (
    select a.user_id, a.out, a.town, a.home_at, a.skal_given from public.after_nights a
     where a.night = v_night and a.user_id in (select user_id from mem)
  ), bars as (
    select c.user_id, count(distinct c.bar_id)::int as n,
           (select jsonb_agg(distinct b.name) from public.medal_checkins c2 join public.bars_lite b on b.id = c2.bar_id
             where c2.user_id = c.user_id and c2.night = v_night and b.name is not null) as names
      from public.medal_checkins c
     where c.night = v_night and c.user_id in (select user_id from mem) group by c.user_id
  ), eta as (
    select e.user_id, max(e.minutes)::int as mx from public.etas e
     where e.user_id in (select user_id from mem) and public.olnu_night_of(e.created_at) = v_night and e.cancelled_at is null
     group by e.user_id
  ), ral as (
    select r.user_id, count(*)::int as n from public.rallies r
     where r.group_id = p_group_id and public.olnu_night_of(r.created_at) = v_night group by r.user_id
  ), rounds as (
    select r.* from public.gang_mt_rounds r where r.group_id = p_group_id and r.night = v_night
  ), mtw as (
    select w.target as user_id, count(*)::int as n from (
      select distinct on (v.round_id) v.round_id, v.target, count(*) over (partition by v.round_id, v.target) as c
        from public.gang_mt_votes v where v.round_id in (select id from rounds)
       order by v.round_id, c desc, v.target) w group by w.target
  ), kb as (
    select distinct on (k.user_id) k.user_id, k.place_name from public.kebab_ratings k
     where k.night = v_night and k.user_id in (select user_id from mem) order by k.user_id, k.stars desc, k.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'k', public.olnu_gang_k(p_group_id, m.user_id), 'name', m.display_name, 'is_me', m.user_id = v_uid,
           'out', coalesce(mn.out, false) or coalesce(an.out, false) or coalesce(b.n, 0) > 0,
           'bars', coalesce(b.n, 0), 'bar_names', coalesce(b.names, '[]'::jsonb),
           'first_at', mn.first_at,
           'home_at', coalesce(an.home_at, case when mn.home then v_night end),
           'skal', coalesce(an.skal_given, 0), 'eta_max', e.mx, 'rallies', coalesce(r.n, 0),
           'mt_wins', coalesce(w.n, 0),
           'quotes', (select count(*) from public.gang_quotes q where q.group_id = p_group_id and q.night = v_night
                       and not q.hidden and lower(q.who) = lower(m.display_name))::int,
           'kebab', kb.place_name) order by m.display_name), '[]'::jsonb),
         (select a.town from an a where a.town is not null group by a.town order by count(*) desc, a.town limit 1)
    into v_mem, v_town
    from mem m
    left join mn on mn.user_id = m.user_id left join an on an.user_id = m.user_id
    left join bars b on b.user_id = m.user_id left join eta e on e.user_id = m.user_id
    left join ral r on r.user_id = m.user_id left join mtw w on w.user_id = m.user_id
    left join kb on kb.user_id = m.user_id;

  select count(*)::int into v_out from jsonb_array_elements(v_mem) x where (x.value ->> 'out')::boolean;

  select coalesce(jsonb_agg(jsonb_build_object('who', q.who, 'body', q.body) order by q.id), '[]'::jsonb) into v_q
    from (select * from public.gang_quotes q where q.group_id = p_group_id and q.night = v_night and not q.hidden
            and q.reveal_at <= now() order by q.id limit 8) q;

  select coalesce(jsonb_agg(jsonb_build_object('q', r.q, 'names', (
           select coalesce(jsonb_agg(public.olnu_gang_name(p_group_id, x.target) order by x.target), '[]'::jsonb) from (
             select v.target, count(*) c, max(count(*)) over () mx from public.gang_mt_votes v
              where v.round_id = r.id group by v.target) x where x.c = x.mx)) order by r.id), '[]'::jsonb)
    into v_mt
    from public.gang_mt_rounds r where r.group_id = p_group_id and r.night = v_night
     and exists (select 1 from public.gang_mt_votes v where v.round_id = r.id);

  begin
    select coalesce(jsonb_agg(distinct t.bar_name), '[]'::jsonb) into v_take
      from public.bar_takeovers t where t.group_id = p_group_id and t.night = v_night and t.bar_name is not null;
  exception when others then v_take := '[]'::jsonb;
  end;
  begin
    select exists (select 1 from public.game_crawls c where c.group_id = p_group_id and c.night = v_night and c.done_at is not null)
      into v_crawl;
  exception when others then v_crawl := false;
  end;

  return jsonb_build_object('night', v_night, 'evening', public.olnu_evening(v_night),
    'group_name', (select g.name from public.groups g where g.id = p_group_id),
    'town', v_town, 'out_n', v_out, 'members', v_mem, 'quotes', v_q, 'mt', v_mt,
    'takeovers', coalesce(v_take, '[]'::jsonb), 'crawl_done', coalesce(v_crawl, false), 'ready', v_out > 0);
end; $function$

;

CREATE OR REPLACE FUNCTION public.group_etas()
 RETURNS TABLE(id bigint, name text, is_me boolean, bar_id text, bar_name text, lat double precision, lng double precision, rally_id bigint, minutes integer, eta_at timestamp with time zone, mins_left integer, created_at timestamp with time zone, arrived boolean, arrived_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  with mine as (select m.group_id, m.display_name from public.group_members m where m.user_id = v_uid)
  select e.id,
         case
           when e.user_id = v_uid then (select min(x.display_name) from mine x)
           when e.group_id is not null then (select gm.display_name from public.group_members gm
                                              where gm.group_id = e.group_id and gm.user_id = e.user_id)
           else (select min(gm.display_name) from public.group_members gm
                  where gm.user_id = e.user_id and gm.group_id in (select x.group_id from mine x))
         end::text,
         e.user_id = v_uid, e.bar_id, e.bar_name, e.lat, e.lng, e.rally_id, e.minutes, e.eta_at,
         greatest(0, ceil(extract(epoch from (e.eta_at - now())) / 60.0))::int, e.created_at,
         e.arrived_at is not null, e.arrived_at
    from public.etas e
   where e.expires_at > now() and e.cancelled_at is null
     and (public.olnu_eta_live(e) or (e.arrived_at > now() - interval '15 minutes' and public.olnu_eta_rally_ok(e)))
     and (
       e.user_id = v_uid
       or (e.group_id is null and exists (
             select 1 from public.group_members gm
              where gm.user_id = e.user_id and gm.group_id in (select x.group_id from mine x)))
       or (e.group_id is not null
           and e.group_id in (select x.group_id from mine x)
           and exists (select 1 from public.group_members gm where gm.group_id = e.group_id and gm.user_id = e.user_id))
     )
   order by e.eta_at
   limit 300;
end; $function$

;

CREATE OR REPLACE FUNCTION public.group_friend_states(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_group_id is null or not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_chief_k(p_group_id, m.user_id), 'name', m.display_name,
           's', case when f.status = 'accepted' then 'friend'
                     when f.status = 'pending' and f.requester = v_uid then 'out'
                     when f.status = 'pending' then 'in'
                     else 'none' end)), '[]'::jsonb)
    into v
    from public.group_members m
    left join public.friendships f
      on least(f.a, f.b) = least(v_uid, m.user_id) and greatest(f.a, f.b) = greatest(v_uid, m.user_id)
   where m.group_id = p_group_id and m.user_id <> v_uid;
  return jsonb_build_object('v', 1, 'states', v);
end $function$

;

CREATE OR REPLACE FUNCTION public.group_league()
 RETURNS TABLE(group_id uuid, name text, total integer, members integer, rank integer, is_mine boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  return query
  with g as (
    select gm.group_id as gid, count(*)::int as cnt, coalesce(sum(wb.n), 0)::int as tot,
           bool_or(gm.user_id = v_uid) as mine
      from public.group_members gm
      left join public.week_beers wb on wb.user_id = gm.user_id and wb.week = public.olnu_week_start(now())
     group by gm.group_id having count(*) >= 2 and (bool_or(gm.user_id = v_uid) or bool_or(not public.olnu_is_test_user(gm.user_id)) or (select public.olnu_is_test_user(v_uid)))
  ),
  r as (
    select g.*, grp.name as gname, grp.created_at as gcreated,
           (row_number() over (order by g.tot desc, grp.created_at asc, g.gid))::int as rnk
      from g join public.groups grp on grp.id = g.gid
  )
  select r.gid, case when r.mine then r.gname else null end, r.tot, r.cnt, r.rnk, r.mine
    from r where r.rnk <= 10 or r.mine order by r.rnk;
end; $function$

;

CREATE OR REPLACE FUNCTION public.group_night_story(p_group_id uuid, p_night date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_tz constant text := 'Europe/Stockholm';
  v_cur timestamptz := public.olnu_night_of(now());
  v_end timestamptz;
  v_start timestamptz;
  v_uids uuid[];
  r record;
  -- clusters (arrivals)
  c_key text[] := '{}'; c_bar text[] := '{}'; c_at timestamptz[] := '{}'; c_last timestamptz[] := '{}';
  c_names jsonb[] := '{}'; c_ks jsonb[] := '{}'; c_from jsonb[] := '{}';
  i int; jj int; v_hit int;
  v_arr jsonb := '[]'::jsonb;
  v_ci jsonb; v_mem jsonb; v_hours jsonb; v_peak jsonb; v_drinks jsonb; v_ral jsonb; v_skal jsonb;
  v_status jsonb; v_duels jsonb; v_chat jsonb; v_photos jsonb;
  v_texts int; v_photos_n int; v_voice_n int; v_total int; v_first timestamptz; v_last timestamptz;
  v_met int; v_met_g text; v_from text; v_town text; v_ready boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if p_night is null then
    v_end := ((v_cur at time zone v_tz) - interval '1 day') at time zone v_tz;
  else
    v_end := ((p_night + 1)::timestamp + time '05:00') at time zone v_tz;
    if v_end > v_cur then v_end := v_cur; end if;
  end if;
  v_start := ((v_end at time zone v_tz) - interval '1 day') at time zone v_tz;
  select coalesce(array_agg(m.user_id), '{}') into v_uids from public.group_members m where m.group_id = p_group_id;

  -- 1. Check-ins in time order (one row per bar change of a member)
  select coalesce(jsonb_agg(jsonb_build_object('at', x.at, 'k', public.olnu_gang_k(p_group_id, x.user_id),
           'name', x.display_name, 'bar', x.bar_name, 'bar_id', x.bar_id, 'from_bar', x.prev_name) order by x.at), '[]'::jsonb)
    into v_ci
    from (select y.* from (
            select t.user_id, t.at, t.bar_id, coalesce(t.bar_name, '?') as bar_name, m.display_name,
                   lag(coalesce(t.bar_id, t.bar_name)) over w as prev_key,
                   lag(t.bar_name) over w as prev_name,
                   row_number() over (order by t.at) as rn
              from public.crew_tracks t
              join public.group_members m on m.group_id = p_group_id and m.user_id = t.user_id
             where t.kind = 'ci' and t.night = v_end
            window w as (partition by t.user_id order by t.at)) y
           where y.prev_key is distinct from coalesce(y.bar_id, y.bar_name)
           order by y.at limit 80) x;

  -- 2. Arrivals: check-ins at the same bar within 30 min merge into one arrival
  for r in select (e.value ->> 'at')::timestamptz as at, e.value ->> 'k' as k, e.value ->> 'name' as name,
                  e.value ->> 'bar' as bar, coalesce(e.value ->> 'bar_id', e.value ->> 'bar') as key, e.value ->> 'from_bar' as from_bar
             from jsonb_array_elements(v_ci) e order by (e.value ->> 'at')::timestamptz loop
    v_hit := null;
    for jj in 1 .. coalesce(array_length(c_key, 1), 0) loop
      if c_key[jj] = r.key and c_last[jj] >= r.at - interval '30 minutes' then v_hit := jj; end if;
    end loop;
    if v_hit is null then
      c_key := array_append(c_key, r.key); c_bar := array_append(c_bar, r.bar);
      c_at := array_append(c_at, r.at); c_last := array_append(c_last, r.at);
      c_names := array_append(c_names, jsonb_build_array(r.name)); c_ks := array_append(c_ks, jsonb_build_array(r.k));
      c_from := array_append(c_from, case when r.from_bar is null then '[]'::jsonb else jsonb_build_array(r.from_bar) end);
    else
      c_last[v_hit] := r.at;
      if not c_ks[v_hit] ? r.k then
        c_names[v_hit] := c_names[v_hit] || jsonb_build_array(r.name);
        c_ks[v_hit] := c_ks[v_hit] || jsonb_build_array(r.k);
      end if;
      if r.from_bar is not null then c_from[v_hit] := c_from[v_hit] || jsonb_build_array(r.from_bar); end if;
    end if;
  end loop;
  for i in 1 .. least(30, coalesce(array_length(c_key, 1), 0)) loop
    -- other app users who checked in at the same bar around the arrival (count only, never who)
    select count(distinct t.user_id)::int into v_met from public.crew_tracks t
     where t.night = v_end and t.kind = 'ci' and t.bar_id = c_key[i]
       and t.at between c_at[i] - interval '60 minutes' and c_last[i] + interval '30 minutes'
       and not (t.user_id = any (v_uids));
    -- a duel opponent group with a member there (only the group name of a duel the group took part in)
    select g.name into v_met_g
      from public.duels d
      join public.groups g on g.id = case when d.group_a = p_group_id then d.group_b else d.group_a end
     where (d.group_a = p_group_id or d.group_b = p_group_id) and d.status = 'active'
       and d.ends_at > v_start and d.ends_at <= v_end + interval '1 hour'
       and exists (select 1 from public.crew_tracks t join public.group_members om on om.user_id = t.user_id and om.group_id = g.id
                    where t.night = v_end and t.kind = 'ci' and t.bar_id = c_key[i] and not (t.user_id = any (v_uids))
                      and t.at between c_at[i] - interval '60 minutes' and c_last[i] + interval '30 minutes')
     limit 1;
    select f.value #>> '{}' into v_from from jsonb_array_elements(c_from[i]) f
     group by f.value #>> '{}' order by count(*) desc limit 1;
    v_arr := v_arr || jsonb_build_array(jsonb_build_object(
      'at', c_at[i], 'last_at', c_last[i], 'bar', c_bar[i], 'bar_id', c_key[i],
      'n', jsonb_array_length(c_names[i]), 'names', c_names[i], 'ks', c_ks[i],
      'from_bar', v_from, 'first', i = 1, 'met_n', coalesce(v_met, 0), 'met_group', v_met_g));
    v_met_g := null; v_from := null;
  end loop;

  -- 3. Drinks per member per hour (duel_log drink deltas, undo = -1), plus medal_nights totals
  with dl as (
    select l.user_id, l.n, l.at, date_trunc('hour', l.at at time zone v_tz) as h
      from public.duel_log l
     where l.kind = 'drink' and l.user_id = any (v_uids) and l.at >= v_start and l.at < v_end
  ), gh as (
    select h, greatest(0, sum(n))::int as n from dl group by h
  )
  select coalesce(jsonb_agg(jsonb_build_object('h', to_char(h, 'HH24'), 'at', h at time zone v_tz, 'n', n) order by h), '[]'::jsonb),
         (select jsonb_build_object('h', to_char(g2.h, 'HH24'), 'at', g2.h at time zone v_tz, 'n', g2.n)
            from gh g2 order by g2.n desc, g2.h limit 1)
    into v_hours, v_peak from gh;
  select min(l.at) filter (where l.n > 0), max(l.at) filter (where l.n > 0) into v_first, v_last
    from public.duel_log l
   where l.kind = 'drink' and l.user_id = any (v_uids) and l.at >= v_start and l.at < v_end;

  with dl as (
    select l.user_id, l.n, l.at, date_trunc('hour', l.at at time zone v_tz) as h
      from public.duel_log l
     where l.kind = 'drink' and l.user_id = any (v_uids) and l.at >= v_start and l.at < v_end
  ), per as (
    select dl.user_id, greatest(0, sum(dl.n))::int as n,
           min(dl.at) filter (where dl.n > 0) as first_at, max(dl.at) filter (where dl.n > 0) as last_at
      from dl group by dl.user_id
  ), ph as (
    select x.user_id, jsonb_agg(jsonb_build_object('h', to_char(x.h, 'HH24'), 'n', x.n) order by x.h) as hours
      from (select dl.user_id, dl.h, greatest(0, sum(dl.n))::int as n from dl group by dl.user_id, dl.h) x
     group by x.user_id
  ), ci as (
    select (e.value ->> 'k') as k, count(*)::int as n, count(distinct coalesce(e.value ->> 'bar_id', e.value ->> 'bar'))::int as bars,
           min((e.value ->> 'at')::timestamptz) as first_ci
      from jsonb_array_elements(v_ci) e group by e.value ->> 'k'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'k', public.olnu_gang_k(p_group_id, m.user_id), 'name', m.display_name, 'is_me', m.user_id = v_uid,
           'drinks', greatest(coalesce(p.n, 0), coalesce(mn.beers + mn.others, 0)),
           'first_at', coalesce(p.first_at, mn.first_at), 'last_at', p.last_at, 'hours', coalesce(ph.hours, '[]'::jsonb),
           'checkins', coalesce(ci.n, 0), 'bars', coalesce(ci.bars, 0), 'first_ci', ci.first_ci,
           'skal_given', coalesce(an.skal_given, 0), 'skal_got', coalesce(an.skal_got, 0), 'home_at', an.home_at,
           'out', coalesce(an.out, false) or coalesce(p.n, 0) > 0 or coalesce(mn.beers + mn.others, 0) > 0 or coalesce(ci.n, 0) > 0)
           order by m.display_name), '[]'::jsonb),
         (select a2.town from public.after_nights a2 where a2.night = v_end and a2.user_id = any (v_uids) and a2.town is not null
           group by a2.town order by count(*) desc, a2.town limit 1)
    into v_mem, v_town
    from public.group_members m
    left join per p on p.user_id = m.user_id
    left join ph on ph.user_id = m.user_id
    left join public.medal_nights mn on mn.user_id = m.user_id and mn.night = v_end
    left join public.after_nights an on an.user_id = m.user_id and an.night = v_end
    left join ci on ci.k = public.olnu_gang_k(p_group_id, m.user_id)
   where m.group_id = p_group_id;

  select coalesce(sum((x.value ->> 'drinks')::int), 0)::int into v_total from jsonb_array_elements(v_mem) x;
  v_drinks := jsonb_build_object('total', v_total, 'hours', v_hours, 'peak', v_peak, 'first_at', v_first, 'last_at', v_last);

  -- 4. Call-outs (rallies) with answers and ETAs
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r2.id, 'at', r2.created_at, 'by', m.display_name, 'by_k', public.olnu_gang_k(p_group_id, r2.user_id),
           'place', r2.place, 'body', r2.body,
           'yes', (select count(*) from public.rally_answers a join public.group_members am on am.group_id = p_group_id and am.user_id = a.user_id
                    where a.rally_id = r2.id and a.answer = 'yes')::int,
           'yes_names', (select coalesce(jsonb_agg(am.display_name order by a.updated_at), '[]'::jsonb) from public.rally_answers a
                          join public.group_members am on am.group_id = p_group_id and am.user_id = a.user_id
                         where a.rally_id = r2.id and a.answer = 'yes'),
           'maybe', (select count(*) from public.rally_answers a join public.group_members am on am.group_id = p_group_id and am.user_id = a.user_id
                      where a.rally_id = r2.id and a.answer = 'maybe')::int,
           'no', (select count(*) from public.rally_answers a join public.group_members am on am.group_id = p_group_id and am.user_id = a.user_id
                   where a.rally_id = r2.id and a.answer = 'no')::int,
           'etas', (select coalesce(jsonb_agg(jsonb_build_object('name', em.display_name, 'minutes', e.minutes,
                                  'eta_at', e.eta_at, 'arrived_at', e.arrived_at) order by e.created_at), '[]'::jsonb)
                      from public.etas e join public.group_members em on em.group_id = p_group_id and em.user_id = e.user_id
                     where e.rally_id = r2.id and e.cancelled_at is null)) order by r2.created_at), '[]'::jsonb)
    into v_ral
    from (select * from public.rallies x where x.group_id = p_group_id and x.created_at >= v_start and x.created_at < v_end
           order by x.created_at limit 12) r2
    left join public.group_members m on m.group_id = p_group_id and m.user_id = r2.user_id;

  -- 5. Skål
  select jsonb_build_object('total', coalesce(sum((x.value ->> 'skal_given')::int), 0)::int,
           'top', (select jsonb_build_object('name', y.value ->> 'name', 'n', (y.value ->> 'skal_given')::int)
                     from jsonb_array_elements(v_mem) y where (y.value ->> 'skal_given')::int > 0
                    order by (y.value ->> 'skal_given')::int desc, y.value ->> 'name' limit 1))
    into v_skal from jsonb_array_elements(v_mem) x;

  -- 6. Chief status reports (0030)
  select coalesce(jsonb_agg(jsonb_build_object('at', s.sj ->> 'created_at', 'by', s.sj ->> 'by',
           'needed', (s.sj ->> 'needed')::int, 'answered', (s.sj ->> 'answered')::int,
           'fastest', (select jsonb_build_object('name', a.value ->> 'name', 'sec', (a.value ->> 'sec')::int)
                         from jsonb_array_elements(s.sj -> 'answers') a
                        where not (a.value ->> 'is_chief')::boolean and (a.value ->> 'in_time')::boolean
                        order by (a.value ->> 'sec')::int limit 1)) order by s.at), '[]'::jsonb)
    into v_status
    from (select x.created_at as at, public.olnu_status_json(x, v_uid) as sj from public.status_reqs x
           where x.group_id = p_group_id and x.night = v_end order by x.created_at limit 6) s;

  -- 7. Duels (0031) with results, from this group's view
  select coalesce(jsonb_agg(jsonb_build_object('at', d.accepted_at, 'opp', d.dj -> 'opp' ->> 'name', 'status', d.dj ->> 'status',
           'winner', d.dj ->> 'winner', 'us', (d.dj -> 'us' ->> 'drinks')::int, 'them', (d.dj -> 'them' ->> 'drinks')::int)
           order by d.accepted_at), '[]'::jsonb)
    into v_duels
    from (select x.*, public.olnu_duel_json(x.id, v_uid) as dj from public.duels x
           where (x.group_a = p_group_id or x.group_b = p_group_id) and x.status = 'active' and x.accepted_at is not null
             and x.ends_at > v_start and x.ends_at <= v_end + interval '1 hour'
           order by x.accepted_at limit 6) d;

  -- 8. Chat highlights: the most-reacted text messages (no photos, no tips), text + name only
  with msgs as (
    select gm.id, gm.body, gm.created_at, m.display_name
      from public.group_msgs gm
      join public.group_members m on m.group_id = p_group_id and m.user_id = gm.user_id
     where gm.group_id = p_group_id and gm.created_at >= v_start and gm.created_at < v_end
       and gm.body not like '📷%' and gm.body not like '📣%'
  ), sc as (
    select ms.*,
      (select count(*) from public.group_msg_reacts x where x.msg_id = ms.id and x.active)::int
      + (select count(*) from public.group_msg_likes x where x.msg_id = ms.id and x.liked)::int as score,
      (select x.emoji from public.group_msg_reacts x where x.msg_id = ms.id and x.active
        group by x.emoji order by count(*) desc, x.emoji limit 1) as emoji
      from msgs ms
  )
  select (select count(*) from msgs)::int,
         coalesce((select jsonb_agg(jsonb_build_object('name', t.display_name, 'body', t.body, 'at', t.created_at,
                    'reacts', t.score, 'emoji', t.emoji) order by t.score desc, t.created_at)
                     from (select * from sc order by sc.score desc, (char_length(sc.body) between 6 and 90) desc, sc.created_at desc limit 6) t),
                  '[]'::jsonb)
    into v_texts, v_chat;

  -- 9. Photos: top 4 by reactions, then newest; only while the bytes are still there
  select count(*)::int into v_photos_n from public.chat_photos cp
   where cp.group_id = p_group_id and cp.created_at >= v_start and cp.created_at < v_end;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'by', p.display_name, 'at', p.created_at, 'w', p.w, 'h', p.h,
           'reacts', p.score, 'caption', nullif(p.caption, ''), 'status', p.status) order by p.score desc, p.created_at desc), '[]'::jsonb)
    into v_photos
    from (select cp.id, cp.created_at, cp.w, cp.h, m.display_name,
                 coalesce((select count(*) from public.group_msg_reacts x where x.msg_id = cp.msg_id and x.active), 0)::int
                 + coalesce((select count(*) from public.group_msg_likes x where x.msg_id = cp.msg_id and x.liked), 0)::int as score,
                 btrim(regexp_replace(coalesce((select gm.body from public.group_msgs gm where gm.id = cp.msg_id), ''),
                                      '^📷\s*(🎖️\s*Lägesrapport:?\s*)?', '')) as caption,
                 coalesce((select gm.body like '📷 🎖️%' from public.group_msgs gm where gm.id = cp.msg_id), false) as status
            from public.chat_photos cp
            join public.group_members m on m.group_id = p_group_id and m.user_id = cp.user_id
           where cp.group_id = p_group_id and cp.created_at >= v_start and cp.created_at < v_end and cp.bytes is not null
           order by 6 desc, cp.created_at desc limit 4) p;

  -- 10. Voice messages (count only)
  select count(*)::int into v_voice_n from public.voice_msgs vm
   where vm.group_id = p_group_id and vm.created_at >= v_start and vm.created_at < v_end;

  v_ready := v_total > 0 or jsonb_array_length(v_ci) > 0;
  return jsonb_build_object('v', 1, 'night', v_end, 'evening', public.olnu_evening(v_end), 'from', v_start, 'to', v_end,
    'group_name', (select g.name from public.groups g where g.id = p_group_id), 'town', v_town,
    'ready', v_ready, 'members', v_mem, 'checkins', v_ci, 'arrivals', v_arr, 'rallies', v_ral, 'drinks', v_drinks,
    'skal', v_skal, 'status', v_status, 'duels', v_duels,
    'chat', jsonb_build_object('texts', v_texts, 'top', v_chat),
    'photos', v_photos, 'photos_n', v_photos_n, 'voice_n', v_voice_n);
end; $function$

;

CREATE OR REPLACE FUNCTION public.group_now(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_out jsonb;
  v_last jsonb;
  v_n int;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select count(*)::int into v_n from public.group_members m where m.group_id = p_group_id;
  with mem as (
    select gm.user_id, gm.display_name from public.group_members gm where gm.group_id = p_group_id
  ), live as (
    select m.user_id, m.display_name, b.beer_count, b.other_count, b.precise, b.snap_bar,
           greatest(coalesce(b.beer_at, b.created_at), coalesce(b.other_at, b.created_at), b.updated_at) as at,
           (select c.bar_name from public.checkins c where c.user_id = m.user_id and c.expires_at > now()
             order by c.created_at desc limit 1) as ci_name,
           (select c.created_at from public.checkins c where c.user_id = m.user_id and c.expires_at > now()
             order by c.created_at desc limit 1) as ci_at
      from mem m
      join public.beers b on b.user_id = m.user_id
     where b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false)
       and coalesce(b.beer_count, 0) + coalesce(b.other_count, 0) > 0
  ), rr as (
    select l.*, coalesce(l.ci_name,
             case when l.precise and l.snap_bar is not null then (select bl.name from public.bars_lite bl where bl.id = l.snap_bar) end) as place,
           case when l.ci_name is null and l.precise then l.snap_bar end as bar_id
      from live l
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', r.display_name, 'i', upper(left(btrim(coalesce(r.display_name, '?')), 1)),
           'place', r.place, 'bar_id', r.bar_id,
           'drinks', coalesce(r.beer_count, 0) + coalesce(r.other_count, 0),
           'at', greatest(r.at, coalesce(r.ci_at, r.at)), 'me', r.user_id = v_uid)
           order by greatest(r.at, coalesce(r.ci_at, r.at)) desc), '[]'::jsonb)
    into v_out from rr r;
  -- newest event tonight: a drink or a check-in (check-ins without a live pin count too)
  select x.j into v_last from (
    select jsonb_build_object('name', m.display_name, 'kind', 'checkin', 'place', c.bar_name, 'at', c.created_at, 'me', m.user_id = v_uid) as j, c.created_at as at
      from public.group_members m join public.checkins c on c.user_id = m.user_id
     where m.group_id = p_group_id and c.expires_at > now()
       and not exists (select 1 from public.beers b where b.user_id = m.user_id and coalesce(b.ghost, false) and b.expires_at > now())
    union all
    select jsonb_build_object('name', m.display_name, 'kind', case when coalesce(b.other_at, '-infinity') > coalesce(b.beer_at, '-infinity') then 'other' else 'beer' end,
             'place', case when b.precise and b.snap_bar is not null then (select bl.name from public.bars_lite bl where bl.id = b.snap_bar) end,
             'at', greatest(coalesce(b.beer_at, b.created_at), coalesce(b.other_at, b.created_at)), 'me', m.user_id = v_uid),
           greatest(coalesce(b.beer_at, b.created_at), coalesce(b.other_at, b.created_at))
      from public.group_members m join public.beers b on b.user_id = m.user_id
     where m.group_id = p_group_id and b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false)
       and coalesce(b.beer_count, 0) + coalesce(b.other_count, 0) > 0
  ) x order by x.at desc limit 1;
  return jsonb_build_object('v', 1, 'now', now(), 'members', v_n, 'out', v_out, 'last', v_last);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.group_status(p_group_id uuid)
 RETURNS TABLE(name text, beers integer, others integer, other_kind text, live boolean, total integer, is_me boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return query
  select gm.display_name,
         coalesce(case when b.expires_at > now() then b.beer_count end, 0)::int,
         coalesce(case when b.expires_at > now() then b.other_count end, 0)::int,
         case when b.expires_at > now() then b.other_kind end,
         coalesce(b.expires_at > now() and not b.stopped, false),
         public.olnu_lifetime(gm.user_id),
         (gm.user_id = v_uid)
    from public.group_members gm
    left join public.beers b on b.user_id = gm.user_id
   where gm.group_id = p_group_id
   order by 2 desc, 3 desc, 1;
end; $function$

;

CREATE OR REPLACE FUNCTION public.group_status_v2(p_group_id uuid)
 RETURNS TABLE(name text, beers integer, others integer, other_kind text, live boolean, total integer, is_me boolean, k text, is_owner boolean, is_chief boolean, is_vice boolean, is_acting boolean, home_town text, can_remove boolean, joined_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_chief uuid;
  v_owner uuid;
  v_act   uuid;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  v_chief := public.olnu_chief_of(p_group_id);
  v_owner := public.olnu_owner_of(p_group_id);
  v_act := public.olnu_acting_vice(p_group_id);
  return query
  select gm.display_name,
         coalesce(case when b.expires_at > now() then b.beer_count end, 0)::int,
         coalesce(case when b.expires_at > now() then b.other_count end, 0)::int,
         case when b.expires_at > now() then b.other_kind end,
         coalesce(b.expires_at > now() and not b.stopped, false),
         public.olnu_lifetime(gm.user_id),
         (gm.user_id = v_uid),
         public.olnu_chief_k(p_group_id, gm.user_id),
         coalesce(gm.user_id = v_owner, false),
         coalesce(gm.user_id = v_chief, false),
         public.olnu_is_vice(p_group_id, gm.user_id),
         coalesce(gm.user_id = v_act, false),
         public.olnu_home_town(gm.user_id),
         public.olnu_remove_block(p_group_id, v_uid, gm.user_id) is null,
         gm.joined_at
    from public.group_members gm
    left join public.beers b on b.user_id = gm.user_id
   where gm.group_id = p_group_id
   order by 2 desc, 3 desc, 1;
end; $function$

;

CREATE OR REPLACE FUNCTION public.home_status(p_last boolean DEFAULT false)
 RETURNS TABLE(group_id uuid, group_name text, name text, is_me boolean, beers integer, others integer, was_out boolean, home boolean, home_at timestamp with time zone, live boolean, night timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := case when coalesce(p_last, false)
                           then public.olnu_night_of(now() - interval '24 hours')
                           else public.olnu_night_of(now()) end;
begin
  return query
  select g.id, g.name, gm.display_name, gm.user_id = v_uid,
         coalesce(mn.beers, 0), coalesce(mn.others, 0),
         coalesce(mn.beers, 0) + coalesce(mn.others, 0) > 0 or coalesce(an.out, false),
         an.home_at is not null or coalesce(mn.home, false),
         an.home_at,
         (not coalesce(p_last, false)) and exists (select 1 from public.beers b where b.user_id = gm.user_id
            and b.expires_at > now() and not b.stopped and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)),
         v_night
    from public.group_members me
    join public.groups g on g.id = me.group_id
    join public.group_members gm on gm.group_id = me.group_id
    left join public.medal_nights mn on mn.user_id = gm.user_id and mn.night = v_night
    left join public.after_nights an on an.user_id = gm.user_id and an.night = v_night
   where me.user_id = v_uid
   order by g.name, gm.display_name
   limit 1000;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.ikvall_status(p_group_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_people jsonb;
begin
  if v_uid is null then raise exception 'not_authed'; end if;
  if p_group_id is not null and not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  with circle as (
    select m2.user_id as uid, min(m2.display_name) as nm, false as friend
      from public.group_members m1 join public.group_members m2 on m2.group_id = m1.group_id
     where m1.user_id = v_uid and m2.user_id <> v_uid and (p_group_id is null or m1.group_id = p_group_id)
     group by m2.user_id
    union all
    select public.olnu_friend_other(f, v_uid), public.olnu_friend_name(public.olnu_friend_other(f, v_uid)), true
      from public.friendships f
     where p_group_id is null and (f.a = v_uid or f.b = v_uid) and f.status = 'accepted'
  ), ppl as (
    select c.uid, max(c.nm) as nm, bool_or(c.friend) as friend from circle c group by c.uid
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(p.nm, 'Någon'), 'st', s.st, 'friend', p.friend, 'at', s.updated_at)
           order by case s.st when 'ute' then 0 when 'kanske' then 1 else 2 end, s.updated_at desc), '[]'::jsonb)
    into v_people
    from ppl p join public.ikvall_status s on s.user_id = p.uid and s.night = v_night
   limit 80;
  return jsonb_build_object('v', 1, 'night', v_night,
    'mine', (select s.st from public.ikvall_status s where s.user_id = v_uid and s.night = v_night),
    'counts', jsonb_build_object(
      'ute', (select count(*) from jsonb_array_elements(v_people) x where x->>'st' = 'ute'),
      'kanske', (select count(*) from jsonb_array_elements(v_people) x where x->>'st' = 'kanske'),
      'hemma', (select count(*) from jsonb_array_elements(v_people) x where x->>'st' = 'hemma')),
    'people', v_people);
end; $function$

;

CREATE OR REPLACE FUNCTION public.live_checkins()
 RETURNS TABLE(bar_id text, bar_name text, lat double precision, lng double precision, name text, is_mine boolean, is_friend boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select c.bar_id, c.bar_name, c.lat, c.lng,
         case when c.user_id = v_uid
              then (select min(mm.display_name) from public.group_members mm where mm.user_id = v_uid)
              else f.fname end,
         (c.user_id = v_uid),
         (c.user_id <> v_uid and f.fname is not null),
         c.created_at
    from public.checkins c
    left join lateral (
      select min(am.display_name) as fname
        from public.group_members am
        join public.group_members cm on cm.group_id = am.group_id and cm.user_id = v_uid
       where am.user_id = c.user_id and c.user_id <> v_uid
    ) f on true
   where c.expires_at > now() and (c.user_id = v_uid or f.fname is not null or not public.olnu_is_test_zone(c.lat, c.lng) or (select public.olnu_is_test_user(v_uid)))
   order by c.created_at
   limit 2000;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.member_medals(p_group_id uuid)
 RETURNS TABLE(name text, is_me boolean, medal text, earned_at timestamp with time zone, count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return query
  select gm.display_name, (gm.user_id = v_uid), um.medal, um.earned_at, um.count
    from public.group_members gm
    join public.user_medals um on um.user_id = gm.user_id
   where gm.group_id = p_group_id
   order by gm.display_name, um.earned_at, um.medal
   limit 5000;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.msg_likes(p_group_id uuid)
 RETURNS TABLE(msg_id bigint, likes integer, liked boolean, names text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_temp boolean := public.olnu_is_temp_group(p_group_id);
begin
  if not public.olnu_chat_can(p_group_id, v_uid, false) then
    raise exception 'not_member';
  end if;
  return query
  select l.msg_id, count(*)::int, bool_or(l.user_id = v_uid),
         array_agg(coalesce(mm.display_name, case when v_temp then public.olnu_friend_name(l.user_id) end, '?') order by l.created_at)
    from public.group_msg_likes l
    join public.group_msgs gm on gm.id = l.msg_id and gm.group_id = p_group_id and gm.expires_at > now()
    left join public.group_members mm on mm.group_id = p_group_id and mm.user_id = l.user_id
   where l.liked
   group by l.msg_id;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.msg_reacts(p_group_id uuid)
 RETURNS TABLE(msg_id bigint, emoji text, n integer, mine boolean, names text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_temp boolean := public.olnu_is_temp_group(p_group_id);
begin
  if not public.olnu_chat_can(p_group_id, v_uid, false) then
    raise exception 'not_member';
  end if;
  return query
  select r.msg_id, r.emoji, count(*)::int, bool_or(r.user_id = v_uid),
         array_agg(coalesce(mm.display_name, case when v_temp then public.olnu_friend_name(r.user_id) end, '?') order by r.created_at)
    from public.group_msg_reacts r
    join public.group_msgs gm on gm.id = r.msg_id and gm.group_id = p_group_id and gm.expires_at > now()
    left join public.group_members mm on mm.group_id = p_group_id and mm.user_id = r.user_id
   where r.active
   group by r.msg_id, r.emoji;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.my_dms()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v jsonb;
  v_n int;
begin
  with t as (
    select d.group_id, d.created_by, d.created_at,
           case when d.a = v_uid then d.b else d.a end as other
      from public.dm_threads d where d.a = v_uid or d.b = v_uid
  ), x as (
    select t.*, lm.id as last_id, lm.body as last_body, lm.created_at as last_at, lm.user_id = v_uid as last_me,
           coalesce(s.seen_id, 0) as my_seen, coalesce(s.muted, false) as muted
      from t
      left join lateral (select m.id, m.body, m.created_at, m.user_id from public.group_msgs m
                          where m.group_id = t.group_id and m.expires_at > now() order by m.id desc limit 1) lm on true
      left join public.dm_state s on s.group_id = t.group_id and s.user_id = v_uid
     where lm.id is not null or (t.created_by = v_uid and t.created_at > now() - interval '1 hour')
     order by coalesce(lm.created_at, t.created_at) desc
     limit 50
  ), y as (
    select x.*, (select count(*) from (select 1 from public.group_msgs m
                   where m.group_id = x.group_id and m.expires_at > now() and m.user_id <> v_uid and m.id > x.my_seen limit 99) z)::int as unread
      from x
  )
  select coalesce(jsonb_agg(public.olnu_dm_json(y.group_id, v_uid) || jsonb_build_object(
           'last_id', y.last_id, 'last_body', left(y.last_body, 80), 'last_at', y.last_at, 'last_me', coalesce(y.last_me, false),
           'unread', y.unread, 'at', coalesce(y.last_at, y.created_at), 'out', coalesce((select po.is_out from public.olnu_friend_out(y.other) po limit 1), false))
         order by coalesce(y.last_at, y.created_at) desc), '[]'::jsonb),
         coalesce(sum(y.unread), 0)::int
    into v, v_n from y;
  return jsonb_build_object('v', 1, 'now', now(), 'unread', v_n, 'threads', v);
end; $function$

;

CREATE OR REPLACE FUNCTION public.olnu_avatar_max()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select '{"ms":1,"hx":16777216,"ux":16777216,"bx":16777216,"h2":22,"ht":3,"sk":22,"fs":7,"ey":21,"ec":11,"br":14,"ns":11,"mt":21,"ck":6,"fm":11,"fp":11,"er":12,"hr":33,"hc":21,"fh":25,"hw":43,"gl":29,"nk":15,"up":30,"uc":19,"bg":38,"hi":16,"fr":10}'::jsonb;
$function$

;

CREATE OR REPLACE FUNCTION public.olnu_chief_json(p_group uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with c as (select public.olnu_chief_of(p_group) as uid),
  o as (select public.olnu_owner_of(p_group) as uid),
  act as (select public.olnu_acting_vice(p_group) as uid),
  pw as (select public.olnu_owner_powers(p_group, p_uid) as yes),
  last as (
    select r.* from public.status_reqs r where r.group_id = p_group order by r.created_at desc, r.id desc limit 1
  ), tonight as (
    select count(*)::int as n from public.status_reqs r where r.group_id = p_group and r.created_at >= public.olnu_chief_from()
  ), mem as (
    select m.user_id, m.display_name, m.joined_at, public.olnu_is_vice(p_group, m.user_id) as vice
      from public.group_members m where m.group_id = p_group
  )
  select jsonb_build_object(
    'group_id', p_group,
    'chief_k', (select public.olnu_chief_k(p_group, c.uid) from c),
    'chief_name', (select public.olnu_chief_name(p_group, c.uid) from c),
    'is_chief', (select c.uid = p_uid from c),
    'is_creator', exists (select 1 from public.groups g where g.id = p_group and g.created_by = p_uid),
    'can_hand', (select yes from pw),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'k', public.olnu_chief_k(p_group, m.user_id), 'name', m.display_name,
        'is_me', m.user_id = p_uid, 'is_chief', m.user_id = (select uid from c),
        'is_owner', m.user_id = (select uid from o), 'is_vice', m.vice,
        'is_acting', m.user_id = (select uid from act),
        'home_town', public.olnu_home_town(m.user_id),
        'can_remove', public.olnu_remove_block(p_group, p_uid, m.user_id) is null)
        order by m.joined_at, m.display_name)
        from mem m), '[]'::jsonb),
    'used', (select n from tonight),
    'max', 6,
    'next_at', greatest(now(), coalesce((select l.created_at + interval '20 minutes' from last l), now())),
    'req', (select public.olnu_status_json(l, p_uid) from last l where l.created_at > now() - interval '2 hours'),
    -- v25 (0034)
    'my_k', public.olnu_chief_k(p_group, p_uid),
    'owner_k', (select public.olnu_chief_k(p_group, o.uid) from o where o.uid is not null),
    'owner_name', (select public.olnu_chief_name(p_group, o.uid) from o),
    'is_owner', (select o.uid = p_uid from o),
    'is_vice', public.olnu_is_vice(p_group, p_uid),
    'owner_powers', (select yes from pw),
    'can_vice', (select yes from pw),
    'can_req', (select c.uid = p_uid from c) or public.olnu_is_vice(p_group, p_uid),
    'can_remove', exists (select 1 from mem m where public.olnu_remove_block(p_group, p_uid, m.user_id) is null),
    'vices', coalesce((select jsonb_agg(jsonb_build_object('k', public.olnu_chief_k(p_group, m.user_id), 'name', m.display_name,
        'is_me', m.user_id = p_uid) order by m.joined_at) from mem m where m.vice), '[]'::jsonb),
    'chief_idle', public.olnu_chief_idle(p_group),
    'acting_k', (select public.olnu_chief_k(p_group, a.uid) from act a where a.uid is not null),
    'acting_name', (select public.olnu_chief_name(p_group, a.uid) from act a),
    'is_acting', (select a.uid = p_uid from act a),
    'chief_home', (select public.olnu_home_town(c.uid) from c),
    'owner_home', (select public.olnu_home_town(o.uid) from o));
$function$

;

CREATE OR REPLACE FUNCTION public.olnu_crew_members(p_group uuid, p_viewer uuid)
 RETURNS TABLE(uid uuid, k text, name text, is_me boolean, state text, left_at timestamp with time zone, lat double precision, lng double precision, bar_id text, bar_name text, pres_at timestamp with time zone, joined_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(now());
begin
  return query
  with m as (
    select gm.user_id, gm.display_name, gm.joined_at from public.group_members gm where gm.group_id = p_group
  ), x as (
    select m.user_id, m.display_name, m.joined_at, p.lat, p.lng, p.bar_id, p.bar_name, p.at,
           (select y.at from public.crew_byes y where y.user_id = m.user_id and y.night = v_night and y.cleared_at is null) as bye_at,
           (select an.home_at from public.after_nights an where an.user_id = m.user_id and an.night = v_night) as home_at,
           coalesce((select an.out from public.after_nights an where an.user_id = m.user_id and an.night = v_night), false) as was_out
      from m left join lateral public.olnu_crew_pres(m.user_id) p on true
  )
  select x.user_id, public.olnu_crew_k(p_group, x.user_id), x.display_name, x.user_id = p_viewer,
         case
           when x.at is not null and (x.bye_at is null or x.at > x.bye_at) and (x.home_at is null or x.at > x.home_at) then 'out'
           when x.bye_at is not null and (x.home_at is null or x.bye_at >= x.home_at) then 'left'
           when x.home_at is not null then 'home'
           when x.was_out then 'quiet'
           else 'none'
         end,
         greatest(x.bye_at, x.home_at),
         x.lat, x.lng, x.bar_id, x.bar_name, x.at, x.joined_at
    from x;
end; $function$

;

CREATE OR REPLACE FUNCTION public.olnu_film_stocks_ok()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select array['kvall', 'midsommar', 'fjall', 'svartvit', 'blixt', 'retro']::text[];
$function$

;

CREATE OR REPLACE FUNCTION public.olnu_g_group(p_uid uuid, p_group uuid, p_now timestamp with time zone, p_full boolean DEFAULT false, p_bingo_n integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_prev  timestamptz := public.olnu_g_prev(public.olnu_night_of(p_now));
  v_out   jsonb := '{}'::jsonb;
  v_j     jsonb;
  v_c     record;
  v_stops jsonb;
  v_dn    int;
  v_card  record;
  v_t     int[];
  v_ticks jsonb;
  v_a     record;
  v_n     int;
  v_bn    int := greatest(9, least(400, coalesce(p_bingo_n, 40)));
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_g_key(p_group, m.user_id), 'name', m.display_name,
           'is_me', m.user_id = p_uid, 'status', s.status, 'at', s.updated_at,
           'out', public.olnu_g_live(m.user_id, v_night, p_now)) order by s.updated_at desc), '[]'::jsonb)
    into v_j
    from public.group_members m
    join public.game_sugen s on s.user_id = m.user_id and s.night = v_night and s.status <> 'none'
   where m.group_id = p_group;
  v_out := v_out || jsonb_build_object('sugen', v_j);

  select * into v_c from public.game_crawls c
   where c.group_id = p_group and c.night = v_night and not c.closed order by c.id desc limit 1;
  if found then
    select jsonb_agg(jsonb_build_object('i', s.ord - 1, 'id', s.v->>'id', 'name', s.v->>'name',
             'lat', (s.v->>'lat')::float8, 'lng', (s.v->>'lng')::float8, 'done', w.names is not null,
             'who', case when p_full then w.names end) order by s.ord),
           count(*) filter (where w.names is not null)
      into v_stops, v_dn
      from jsonb_array_elements(v_c.stops) with ordinality s(v, ord)
      left join lateral (
        select jsonb_agg(m.display_name order by m.display_name) as names
          from public.group_members m
          join public.medal_checkins mc on mc.user_id = m.user_id and mc.night = v_night and mc.bar_id = s.v->>'id'
         where m.group_id = p_group) w on true;
    if v_dn >= v_c.n and v_c.done_at is null then
      update public.game_crawls c set done_at = p_now where c.id = v_c.id and c.done_at is null;
      v_c.done_at := p_now;
    end if;
    v_out := v_out || jsonb_build_object('crawl', jsonb_build_object(
      'id', v_c.id, 'n', v_c.n, 'done_n', v_dn, 'done', v_c.done_at is not null, 'done_at', v_c.done_at,
      'is_mine', v_c.user_id = p_uid, 'created_at', v_c.created_at,
      'by', (select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = v_c.user_id),
      'stops', v_stops));
  else
    v_out := v_out || jsonb_build_object('crawl', null);
  end if;

  select * into v_card from public.game_bingo_cards b where b.group_id = p_group and b.night = v_night;
  if not found and p_full then
    insert into public.game_bingo_cards (group_id, night, card, n)
    select p_group, v_night, array_agg(z.x), v_bn
      from (select x from generate_series(0, v_bn - 1) x order by random() limit 9) z
    on conflict do nothing;
    select * into v_card from public.game_bingo_cards b where b.group_id = p_group and b.night = v_night;
  end if;
  if v_card.group_id is not null then
    select array_agg(t.idx::int order by t.idx),
           jsonb_agg(jsonb_build_object('idx', t.idx, 'name', m.display_name, 'is_me', t.user_id = p_uid) order by t.idx)
      into v_t, v_ticks
      from public.game_bingo_ticks t
      left join public.group_members m on m.group_id = p_group and m.user_id = t.user_id
     where t.group_id = p_group and t.night = v_night and t.ticked;
    v_out := v_out || jsonb_build_object('bingo', jsonb_build_object(
      'card', case when p_full then to_jsonb(v_card.card) end, 'n', v_card.n,
      'ticks', case when p_full then coalesce(v_ticks, '[]'::jsonb) else to_jsonb(coalesce(array_length(v_t, 1), 0)) end,
      'lines', public.olnu_g_lines(v_t), 'bingo_at', v_card.bingo_at));
  else
    v_out := v_out || jsonb_build_object('bingo', null);
  end if;

  select * into v_a from public.game_agents a where a.group_id = p_group and a.night = v_night;
  if found then
    v_out := v_out || jsonb_build_object('agent', jsonb_build_object(
      'active', true, 'is_me', v_a.agent = p_uid, 'mission', case when v_a.agent = p_uid then v_a.mission end,
      'by', (select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = v_a.started_by)));
  else
    v_out := v_out || jsonb_build_object('agent', null);
  end if;

  begin
    perform public.olnu_g_reveal(p_group, v_prev, p_now);
  exception when others then
    null;
  end;
  select * into v_a from public.game_agents a where a.group_id = p_group and a.night = v_prev;
  if found then
    select count(*) into v_n from public.game_agent_votes v where v.group_id = p_group and v.night = v_prev;
    v_j := jsonb_build_object(
      'revealed', v_a.revealed_at is not null, 'voting', v_a.revealed_at is null,
      'reveal_at', ((v_prev at time zone 'Europe/Stockholm') + interval '7 hours') at time zone 'Europe/Stockholm',
      'votes', v_n,
      'needed', (select count(*) from public.group_members m where m.group_id = p_group and m.user_id <> v_a.agent),
      'is_agent', v_a.agent = p_uid,
      'my_vote', (select public.olnu_g_key(p_group, v.suspect) from public.game_agent_votes v
                   where v.group_id = p_group and v.night = v_prev and v.voter = p_uid),
      'mission', case when v_a.revealed_at is not null or v_a.agent = p_uid then v_a.mission end);
    if v_a.revealed_at is not null then
      v_j := v_j || jsonb_build_object(
        'agent_name', (select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = v_a.agent),
        'agent_k', public.olnu_g_key(p_group, v_a.agent), 'correct', coalesce(v_a.correct, 0),
        'correct_names', (select coalesce(jsonb_agg(m.display_name order by v.created_at), '[]'::jsonb)
                            from public.game_agent_votes v
                            join public.group_members m on m.group_id = p_group and m.user_id = v.voter
                           where v.group_id = p_group and v.night = v_prev and v.suspect = v_a.agent),
        'i_was_right', exists (select 1 from public.game_agent_votes v where v.group_id = p_group and v.night = v_prev
                                 and v.voter = p_uid and v.suspect = v_a.agent));
    end if;
    v_out := v_out || jsonb_build_object('agent_prev', v_j);
  else
    v_out := v_out || jsonb_build_object('agent_prev', null);
  end if;

  begin
    perform public.olnu_g_oracle(p_group, v_prev, p_now);
  exception when others then
    null;
  end;
  select o.*, m.display_name into v_a from public.game_oracles o
    left join public.group_members m on m.group_id = p_group and m.user_id = o.user_id
   where o.group_id = p_group and o.night = v_prev;
  if found then
    v_out := v_out || jsonb_build_object('oracle', jsonb_build_object(
      'name', v_a.display_name, 'is_me', v_a.user_id = p_uid, 'guess', v_a.guess, 'real', v_a.real,
      'err', round(v_a.err::numeric, 3), 'guessers', v_a.guessers));
  else
    v_out := v_out || jsonb_build_object('oracle', null);
  end if;

  if p_full then
    select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_g_key(p_group, m.user_id), 'name', m.display_name,
             'is_me', m.user_id = p_uid, 'out', public.olnu_g_live(m.user_id, v_night, p_now)) order by m.joined_at), '[]'::jsonb)
      into v_j from public.group_members m where m.group_id = p_group;
    v_out := v_out || jsonb_build_object('members', v_j);

    select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'is_me', x.is_me, 'pts', x.pts) order by x.pts desc, x.name), '[]'::jsonb)
      into v_j
      from (select m.display_name as name, m.user_id = p_uid as is_me,
                   (select count(*) from public.game_agent_votes v
                      join public.game_agents a on a.group_id = v.group_id and a.night = v.night
                     where v.group_id = p_group and v.voter = m.user_id and v.suspect = a.agent and a.revealed_at is not null)
                   + 2 * (select count(*) from public.game_agents a
                           where a.group_id = p_group and a.agent = m.user_id and a.revealed_at is not null
                             and coalesce(a.correct, 0) = 0 and coalesce(a.votes, 0) >= 1) as pts
              from public.group_members m where m.group_id = p_group) x
     where x.pts > 0;
    v_out := v_out || jsonb_build_object('points', v_j);

    select coalesce(jsonb_agg(jsonb_build_object('name', m.display_name, 'is_me', m.user_id = p_uid,
             'guess', g.guess, 'real', g.real, 'town', g.town) order by abs(g.guess - coalesce(g.real, 0))), '[]'::jsonb)
      into v_j
      from public.game_guesses g join public.group_members m on m.user_id = g.user_id and m.group_id = p_group
     where g.night = v_prev;
    v_out := v_out || jsonb_build_object('guesses_prev', v_j);

    select coalesce(jsonb_agg(jsonb_build_object('name', m.display_name, 'is_me', m.user_id = p_uid) order by g.created_at), '[]'::jsonb)
      into v_j
      from public.game_guesses g join public.group_members m on m.user_id = g.user_id and m.group_id = p_group
     where g.night = v_night;
    v_out := v_out || jsonb_build_object('guessed', v_j);
  end if;

  return v_out || jsonb_build_object('night', v_night);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.olnu_pins(p_uid uuid, p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision)
 RETURNS TABLE(beer_id bigint, pin_id text, lat double precision, lng double precision, snap text, bar_id text, precise boolean, beer_count integer, other_count integer, other_kind text, created_at timestamp with time zone, is_mine boolean, is_friend boolean, friend_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_box    boolean := p_min_lat is not null and p_min_lng is not null and p_max_lat is not null and p_max_lng is not null;
  v_secret text := (select s.secret from public.olnu_secrets s where s.id = 1);
  v_bucket bigint := floor(extract(epoch from now()) / 600)::bigint;
  v_store  boolean := public.olnu_store_on();
  v_a float8 := p_min_lat - 0.0035;  v_c float8 := p_max_lat + 0.0035;
  v_b float8 := p_min_lng - 0.0070;  v_d float8 := p_max_lng + 0.0070;
begin
  return query
  with mates as (
    select am.user_id as uid, min(am.display_name) as fname
      from public.group_members cm
      join public.group_members am on am.group_id = cm.group_id
     where cm.user_id = p_uid and am.user_id <> p_uid
     group by am.user_id
  ),
  me_and_mates as (
    select m.uid, m.fname from mates m
    union all
    select p_uid, null::text
  ),
  cand as (
    select b.id, b.user_id, b.lat, b.lng, b.precise, b.beer_count, b.other_count, b.other_kind, b.created_at,
           b.snap_lat, b.snap_lng, b.snap_bar, mm.uid is not null as known, mm.fname
      from public.beers b
      left join me_and_mates mm on mm.uid = b.user_id
     where b.expires_at > now() and not b.stopped
       and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
       and (not v_box or (b.lat between v_a and v_c and b.lng between v_b and v_d))
    union all
    select b.id, b.user_id, b.lat, b.lng, b.precise, b.beer_count, b.other_count, b.other_kind, b.created_at,
           b.snap_lat, b.snap_lng, b.snap_bar, true, mm.fname
      from me_and_mates mm
      join public.beers b on b.user_id = mm.uid
     where v_box and b.expires_at > now() and not b.stopped
       and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
       and not (b.lat between v_a and v_c and b.lng between v_b and v_d)
  )
  select c.id,
         case when c.known then c.id::text
              else 'p' || left(md5(v_secret || ':' || c.id::text || ':' || v_bucket::text), 15) end,
         case when c.known then c.lat else coalesce(c.snap_lat, (round(c.lat::numeric / 0.005) * 0.005)::float8) end,
         case when c.known then c.lng else coalesce(c.snap_lng, (round(c.lng::numeric / 0.01) * 0.01)::float8) end,
         case when c.known then (case when c.precise then 'exact' else 'area' end)
              when c.snap_bar is not null then 'bar' else 'area' end,
         c.snap_bar,
         case when c.known then c.precise else c.snap_bar is not null end,
         case when v_store and not c.known then 1 else c.beer_count end,
         case when v_store and not c.known then 0 else coalesce(c.other_count, 0) end,
         case when v_store and not c.known then null else c.other_kind end,
         case when c.known then c.created_at
              else to_timestamp(floor(extract(epoch from c.created_at) / 900) * 900) end,
         c.user_id = p_uid, c.known and c.user_id <> p_uid, c.fname
    from cand c
   where (c.known or not v_box
      or (coalesce(c.snap_lat, c.lat) between p_min_lat and p_max_lat
          and coalesce(c.snap_lng, c.lng) between p_min_lng and p_max_lng))
     and (c.known or not public.olnu_is_test_zone(c.lat, c.lng) or (select public.olnu_is_test_user(p_uid)))
     and not public.olnu_ub_hidden(p_uid, c.user_id);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.olnu_rally_rows(p_uid uuid, p_group_id uuid)
 RETURNS TABLE(id bigint, name text, body text, place text, lat double precision, lng double precision, created_at timestamp with time zone, yes integer, no integer, maybe integer, my_answer text, yes_names text[], is_mine boolean, group_id uuid, group_name text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select r.id, cm.display_name, r.body, r.place, r.lat, r.lng, r.created_at,
         coalesce(c.y, 0), coalesce(c.n, 0), coalesce(c.m, 0),
         (select a.answer from public.rally_answers a where a.rally_id = r.id and a.user_id = p_uid),
         coalesce(c.names, array[]::text[]),
         (r.user_id = p_uid), r.group_id, g.name
    from public.rallies r
    join public.group_members me on me.group_id = r.group_id and me.user_id = p_uid
    left join public.groups g on g.id = r.group_id
    left join public.group_members cm on cm.group_id = r.group_id and cm.user_id = r.user_id
    left join lateral (
      select count(*) filter (where a.answer = 'yes')::int as y,
             count(*) filter (where a.answer = 'no')::int as n,
             count(*) filter (where a.answer = 'maybe')::int as m,
             array_agg(gm.display_name order by (a.user_id = r.user_id) desc, a.updated_at, gm.display_name)
               filter (where a.answer = 'yes') as names
        from public.rally_answers a
        join public.group_members gm on gm.group_id = r.group_id and gm.user_id = a.user_id
       where a.rally_id = r.id
    ) c on true
   where r.expires_at > now() and not r.closed
     and (p_group_id is null or r.group_id = p_group_id)
   order by r.created_at desc, r.id desc
   limit 10;
$function$

;

CREATE OR REPLACE FUNCTION public.olnu_swh_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status is distinct from 'ok' then return new; end if;
  if new.source = 'swehockey' then
    if coalesce(new.league, '') ~* '^Hockey(Ettan|Tvåan|Trean) Dam' then
      new.status := 'hidden';
    elsif exists (select 1 from public.bar_events b where b.source = 'swehockey' and b.status = 'ok'
                  and b.title = new.title and b.starts_at = new.starts_at and b.source_id is distinct from new.source_id) then
      new.status := 'hidden';
    end if;
  elsif new.source = 'tv' and new.source_id like 'tv:swh:%' then
    if exists (select 1 from public.bar_events b where b.source = 'swehockey' and b.source_id = substr(new.source_id, 4)
               and b.status = 'hidden') then
      new.status := 'hidden';
    elsif exists (select 1 from public.bar_events b where b.source = 'tv' and b.status = 'ok'
                  and b.title = new.title and b.starts_at = new.starts_at and b.source_id is distinct from new.source_id) then
      new.status := 'hidden';
    end if;
  elsif new.source = 'tickster' then
    if exists (select 1 from public.bar_events b where b.source = 'swehockey' and b.status = 'ok'
               and b.starts_at = new.starts_at and b.title = replace(new.title, ' - ', ' – ')) then
      new.status := 'hidden';
    end if;
  end if;
  return new;
end $function$

;

CREATE OR REPLACE FUNCTION public.olnu_wd_owner_ok(p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (select count(*) from public.owner_key_fails f where f.at > now() - interval '1 hour') > 20 then
    raise exception 'rate_limited';
  end if;
  if p_key is null or char_length(p_key) > 200 or not exists (
       select 1 from public.owner_keys k where k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    insert into public.owner_key_fails (at) values (now());
    perform set_config('response.status', '403', true);
    return false;
  end if;
  return true;
end; $function$

;

CREATE OR REPLACE FUNCTION public.owner_move_stats(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if (select count(*) from public.owner_key_fails f where f.at > now() - interval '1 hour') > 20 then
    raise exception 'rate_limited';
  end if;
  if p_key is null or char_length(p_key) > 200 or not exists (
       select 1 from public.owner_keys k where k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    insert into public.owner_key_fails (at) values (now());
    perform set_config('response.status', '403', true);
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return (
    select jsonb_build_object(
      'tickets', count(*),
      'moved_users', count(distinct user_id) filter (where done_at is not null),
      'taken_not_done', count(*) filter (where taken_at is not null and done_at is null),
      'never_taken', count(*) filter (where taken_at is null and expires_at < now()),
      'open', count(*) filter (where taken_at is null and expires_at >= now()),
      'by_src', coalesce((select jsonb_object_agg(s, c) from (
          select coalesce(nullif(src, ''), '?') s, count(*) filter (where done_at is not null) c
            from public.handover_tickets group by 1) x), '{}'::jsonb),
      'last_24h_done', count(*) filter (where done_at > now() - interval '24 hours'))
    from public.handover_tickets);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.owner_stats(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now       timestamptz := now();
  v_tz        text := 'Europe/Stockholm';
  v_next      timestamptz := public.olnu_next_expiry();
  v_next_loc  timestamp := public.olnu_next_expiry() at time zone 'Europe/Stockholm';
  v_first     timestamptz;
  v_today     timestamptz := date_trunc('day', now() at time zone 'Europe/Stockholm') at time zone 'Europe/Stockholm';
  v_medals    boolean := to_regclass('public.medal_nights') is not null;
  v_mcheck    boolean := to_regclass('public.medal_checkins') is not null;
  v_users     jsonb;
  v_beers     jsonb;
  v_places    jsonb;
  v_social    jsonb;
  v_care      jsonb;
  v_tech      jsonb := '{}'::jsonb;
  v_nights    jsonb;
  v_hours     jsonb;
  v_n         bigint;
  r           record;
begin
  if (select count(*) from public.owner_key_fails f where f.at > v_now - interval '1 hour') > 20 then
    raise exception 'rate_limited';
  end if;

  if p_key is null or char_length(p_key) > 200 or not exists (
       select 1 from public.owner_keys k
        where k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    insert into public.owner_key_fails (at) values (v_now);
    perform set_config('response.status', '403', true);
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;

  v_first := (v_next_loc - interval '29 days') at time zone v_tz;

  select coalesce(jsonb_agg(jsonb_build_object(
           'night', to_char(((g.night at time zone v_tz) - interval '6 hours')::date, 'YYYY-MM-DD'),
           'beers', greatest(coalesce(u.b, 0), coalesce(e.b, 0)),
           'others', coalesce(u.o, 0),
           'people', coalesce(u.p, 0),
           'hot', greatest(coalesce(u.hot, 0), coalesce(e.hot, 0)),
           'medevac', greatest(coalesce(u.med, 0), coalesce(e.med, 0)),
           'home', coalesce(u.home, 0),
           'drinks', greatest(coalesce(u.b, 0), coalesce(e.b, 0)) + coalesce(u.o, 0)
         ) order by g.night), '[]'::jsonb)
    into v_nights
    from (select (v_next_loc - make_interval(days => k)) at time zone v_tz as night
            from generate_series(0, 29) k) g
    left join (select night, sum(b)::int b, sum(o)::int o,
                      count(*) filter (where b > 0 or o > 0)::int p,
                      count(*) filter (where b + o >= 5 and b + o < 10)::int hot,
                      count(*) filter (where b + o >= 10)::int med,
                      count(*) filter (where home)::int home
                 from public.olnu_owner_un(v_first) group by night) u on u.night = g.night
    left join (select expires_at night, count(*)::int b,
                      count(*) filter (where n = 5)::int hot,
                      count(*) filter (where n = 10)::int med
                 from public.beer_events where kind = 'beer' and expires_at >= v_first
                group by 1) e on e.night = g.night;

  select jsonb_build_object(
    'total', (select count(*) from auth.users),
    'named', (select count(distinct user_id) from public.group_members),
    'new_today', (select count(*) from auth.users where created_at >= v_today),
    'new_7d', (select count(*) from auth.users where created_at > v_now - interval '7 days'),
    'new_30d', (select count(*) from auth.users where created_at > v_now - interval '30 days'),
    'active_tonight', (select count(distinct uid) from (
        select user_id uid from public.beers
         where expires_at = v_next and (coalesce(beer_count, 0) + coalesce(other_count, 0) + coalesce(shot_count, 0)) > 0
        union all
        select user_id from public.checkins where expires_at = v_next) a),
    'out_now', (select count(*) from public.beers where expires_at > v_now and not coalesce(stopped, false)),
    'active_7d', (select count(distinct uid) from (
        select user_id uid from public.olnu_owner_un(v_first) where night > v_now - interval '7 days' and (b > 0 or o > 0)
        union all select user_id from public.checkins where created_at > v_now - interval '7 days'
        union all select user_id from public.group_msgs where created_at > v_now - interval '7 days'
        union all select user_id from public.skals where created_at > v_now - interval '7 days'
        union all select user_id from public.reactions where updated_at > v_now - interval '7 days'
        union all select user_id from public.rally_answers where updated_at > v_now - interval '7 days') a),
    'opened_7d', (select count(distinct user_id) from auth.sessions where updated_at > v_now - interval '7 days'),
    'push', (select count(distinct user_id) from public.push_subscriptions)
  ) into v_users;

  select coalesce(jsonb_agg(coalesce(h.n, 0) order by g.hr), '[]'::jsonb) into v_hours
    from generate_series(0, 23) g(hr)
    left join (select extract(hour from (hour at time zone v_tz))::int hr, sum(beers)::int n
                 from public.owner_hours where hour > v_now - interval '30 days' group by 1) h on h.hr = g.hr;

  select jsonb_build_object(
    'tonight', (v_nights -> 29 ->> 'beers')::int,
    'others_tonight', (v_nights -> 29 ->> 'others')::int,
    'last_night', (v_nights -> 28 ->> 'beers')::int,
    'per_night', v_nights,
    'all_time', greatest(
        (select coalesce(sum(n), 0) from public.week_beers),
        (select count(*) from public.beer_events where kind = 'beer'),
        case when v_medals then (select coalesce(sum(beers + others), 0) from public.medal_nights) else 0 end),
    'avg_per_person', (select round(avg(b + o)::numeric, 2) from public.olnu_owner_un(v_first) where b + o > 0),
    'peak_hours', v_hours,
    'drinks_tonight', (v_nights -> 29 ->> 'drinks')::int,
    'drinks_last_night', (v_nights -> 28 ->> 'drinks')::int
  ) into v_beers;

  select jsonb_build_object(
    'top_bars', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'beers', t.beers, 'checkins', t.ch)
                          order by t.beers desc, t.ch desc, t.name), '[]'::jsonb)
                   from (select coalesce(bt.name, ck.name) as name, coalesce(bt.n, 0) beers, coalesce(ck.n, 0) ch
                           from (select bar_id, max(bar_name) name, sum(n)::int n from public.bar_taps
                                  where week >= public.olnu_week_start(v_now - interval '30 days') group by bar_id) bt
                           full join (select bar_id, max(bar_name) name, count(*)::int n from public.checkins
                                       where created_at > v_now - interval '30 days' group by bar_id) ck
                             on ck.bar_id = bt.bar_id
                          order by 2 desc, 3 desc, 1
                          limit 10) t),
    'checkins_tonight', (select count(*) from public.checkins where expires_at = v_next),
    'checkins_30d', case when v_mcheck
        then (select count(*) from public.medal_checkins where night >= v_first)
        else (select count(*) from public.checkins where created_at > v_now - interval '30 days') end,
    'checkin_users_30d', (select count(*) from public.checkins where created_at > v_now - interval '30 days')
  ) into v_places;

  select jsonb_build_object(
    'groups', (select count(*) from public.groups),
    'groups_2plus', (select count(*) from (select group_id from public.group_members group by 1 having count(*) >= 2) g),
    'avg_group_size', (select round(avg(c)::numeric, 1) from (select count(*) c from public.group_members group by group_id) g),
    'msgs_7d', (select count(*) from public.group_msgs where created_at > v_now - interval '7 days'),
    'skal_7d', (select count(*) from public.skals where created_at > v_now - interval '7 days'),
    'rallies_7d', (select count(*) from public.rallies where created_at > v_now - interval '7 days'),
    'reactions_7d', (select count(*) from public.reactions where created_at > v_now - interval '7 days')
  ) into v_social;

  select jsonb_build_object(
    'hot_tonight', (select count(*) from public.beers where expires_at = v_next
                       and beer_count + coalesce(other_count, 0) >= 5 and beer_count + coalesce(other_count, 0) < 10),
    'medevac_tonight', (select count(*) from public.beers where expires_at = v_next
                           and beer_count + coalesce(other_count, 0) >= 10),
    'home_7d', (select coalesce(sum((x ->> 'home')::int), 0)
                  from jsonb_array_elements(v_nights) with ordinality as a(x, i) where a.i > 23),
    'home_tracked', v_medals
  ) into v_care;

  for r in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('select count(*) from public.%I', r.tablename) into v_n;
    v_tech := v_tech || jsonb_build_object(r.tablename, v_n);
  end loop;
  v_tech := v_tech || jsonb_build_object('auth.users', (select count(*) from auth.users));

  return jsonb_build_object(
    'generated_at', v_now,
    'night_ends', v_next,
    'users', v_users,
    'beers', v_beers,
    'places', v_places,
    'social', v_social,
    'care', v_care,
    'tech', v_tech
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.poll_public(p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision, p_heat boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cap  constant int := 1500;
  v_a float8; v_b float8; v_c float8; v_d float8;
  v_clat float8; v_clng float8; v_cos float8; v_mlat float8; v_mlng float8;
  v_pins json; v_n_str int;
begin
  if p_min_lat is null or p_min_lng is null or p_max_lat is null or p_max_lng is null
     or 'NaN'::float8 in (p_min_lat, p_min_lng, p_max_lat, p_max_lng)
     or abs(p_min_lat) = 'Infinity'::float8 or abs(p_max_lat) = 'Infinity'::float8
     or abs(p_min_lng) = 'Infinity'::float8 or abs(p_max_lng) = 'Infinity'::float8 then
    raise exception 'invalid_bbox';
  end if;
  -- same box rules as poll_v2 (date line, 15 % margin, clamp)
  v_a := least(p_min_lat, p_max_lat);  v_c := greatest(p_min_lat, p_max_lat);
  v_b := least(p_min_lng, p_max_lng);  v_d := greatest(p_min_lng, p_max_lng);
  if p_min_lng > p_max_lng and p_min_lng <= 180 and p_max_lng >= -180 then v_b := -180; v_d := 180; end if;
  v_mlat := greatest((v_c - v_a) * 0.15, 0.005);
  v_mlng := greatest((v_d - v_b) * 0.15, 0.01);
  v_a := greatest(-85.0, v_a - v_mlat);  v_c := least(85.0, v_c + v_mlat);
  v_b := v_b - v_mlng;  v_d := v_d + v_mlng;
  if v_b < -180 or v_d > 180 then v_b := -180; v_d := 180; end if;
  if v_a > v_c or v_b > v_d then v_a := 0; v_c := 0; v_b := 0; v_d := 0; end if;
  v_clat := (v_a + v_c) / 2;  v_clng := (v_b + v_d) / 2;  v_cos := cos(radians(v_clat));

  with p as (select * from public.olnu_pins(null::uuid, v_a, v_b, v_c, v_d)),
  ranked as (
    select p.*, row_number() over (order by power(p.lat - v_clat, 2) + power((p.lng - v_clng) * v_cos, 2), p.pin_id) as rn,
           count(*) over () as nstr
      from p
  ),
  sel as (select * from ranked r where r.rn <= v_cap),
  sk as (select s.beer_id as sid, count(*)::int as n from public.skals s join sel on sel.beer_id = s.beer_id group by s.beer_id),
  rx1 as (select r.beer_id as rid, r.emoji, count(*)::int as n from public.reactions r join sel on sel.beer_id = r.beer_id where r.active group by r.beer_id, r.emoji),
  rx as (select rx1.rid, jsonb_object_agg(rx1.emoji, rx1.n) as counts from rx1 group by rx1.rid)
  select coalesce(json_agg(json_strip_nulls(json_build_object(
           'id', sel.pin_id, 'lat', sel.lat, 'lng', sel.lng, 'snap', sel.snap, 'bar_id', sel.bar_id, 'precise', sel.precise,
           'beer_count', sel.beer_count, 'other_count', nullif(sel.other_count, 0),
           'other_kind', case when sel.other_count > 0 then sel.other_kind end,
           'created_at', sel.created_at, 'skal_count', sk.n, 'rx', rx.counts
         )) order by sel.created_at, sel.pin_id), '[]'::json),
         coalesce(max(sel.nstr), 0)
    into v_pins, v_n_str
    from sel left join sk on sk.sid = sel.beer_id left join rx on rx.rid = sel.beer_id;

  return json_build_object(
    'v', 1, 'public', true, 'server_time', now(), 'full', true,
    'bbox', json_build_array(v_a, v_b, v_c, v_d),
    'pins', v_pins, 'capped', v_n_str > v_cap, 'pins_in_view', v_n_str,
    'live_total', (select count(*)::int from public.beers b
                    where b.expires_at > now() and not b.stopped
                      and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
                      and not public.olnu_is_test_zone(b.lat, b.lng)),
    'me', null,
    'checkins', (select coalesce(json_agg(json_build_object(
                    'bar_id', c.bar_id, 'bar_name', c.bar_name, 'lat', c.lat, 'lng', c.lng, 'name', null,
                    'is_mine', false, 'is_friend', false,
                    'created_at', to_timestamp(floor(extract(epoch from c.created_at) / 900) * 900)
                  ) order by c.created_at), '[]'::json)
                   from (select * from public.checkins c0
                          where c0.expires_at > now() and not public.olnu_is_test_zone(c0.lat, c0.lng)
                            and c0.lat between v_a and v_c and c0.lng between v_b and v_d
                          order by c0.created_at limit 2000) c),
    'rallies', '[]'::json,
    'heat', case when coalesce(p_heat, false) then
              (select coalesce(json_agg(json_build_array(h.lat, h.lng, h.w)), '[]'::json)
                 from public.olnu_heat(v_a - (v_c - v_a) * 0.5, v_b - (v_d - v_b) * 0.5,
                                       v_c + (v_c - v_a) * 0.5, v_d + (v_d - v_b) * 0.5, 3000) h)
            end
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.poll_v2(p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_heat boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := public.olnu_uid();
  v_cap     constant int := 1500;
  v_a       float8; v_b float8; v_c float8; v_d float8;
  v_clat    float8; v_clng float8; v_cos float8;
  v_mlat    float8; v_mlng float8;
  v_pins    json;
  v_n_str   int;
  v_me      jsonb;
  v_row     public.beers%rowtype;
  v_out     json;
  v_bucket  bigint := floor(extract(epoch from now()) / 600)::bigint;
begin
  if p_min_lat is null or p_min_lng is null or p_max_lat is null or p_max_lng is null
     or 'NaN'::float8 in (p_min_lat, p_min_lng, p_max_lat, p_max_lng)
     or abs(p_min_lat) = 'Infinity'::float8 or abs(p_max_lat) = 'Infinity'::float8
     or abs(p_min_lng) = 'Infinity'::float8 or abs(p_max_lng) = 'Infinity'::float8 then
    raise exception 'invalid_bbox';
  end if;
  v_a := least(p_min_lat, p_max_lat);  v_c := greatest(p_min_lat, p_max_lat);
  v_b := least(p_min_lng, p_max_lng);  v_d := greatest(p_min_lng, p_max_lng);
  -- v17: worldwide. A box across the date line (min lng > max lng) = the whole lng range.
  if p_min_lng > p_max_lng and p_min_lng <= 180 and p_max_lng >= -180 then
    v_b := -180;  v_d := 180;
  end if;
  -- 15 % margin on each side (at least ~550 m), then clamp to the world (|lat| <= 85).
  v_mlat := greatest((v_c - v_a) * 0.15, 0.005);
  v_mlng := greatest((v_d - v_b) * 0.15, 0.01);
  v_a := greatest(-85.0, v_a - v_mlat);  v_c := least(85.0, v_c + v_mlat);
  v_b := v_b - v_mlng;  v_d := v_d + v_mlng;
  if v_b < -180 or v_d > 180 then v_b := -180;  v_d := 180; end if;
  if v_a > v_c or v_b > v_d then
    -- Empty box: only the caller and group-mates.
    v_a := 0; v_c := 0; v_b := 0; v_d := 0;
  end if;
  v_clat := (v_a + v_c) / 2;  v_clng := (v_b + v_d) / 2;  v_cos := cos(radians(v_clat));

  with p as (
    select * from public.olnu_pins(v_uid, v_a, v_b, v_c, v_d)
  ),
  ranked as (
    select p.*,
           row_number() over (partition by (p.is_mine or p.is_friend)
                              order by power(p.lat - v_clat, 2) + power((p.lng - v_clng) * v_cos, 2), p.pin_id) as rn,
           count(*) filter (where not (p.is_mine or p.is_friend)) over () as nstr
      from p
  ),
  sel as (
    select * from ranked r where r.is_mine or r.is_friend or r.rn <= v_cap
  ),
  sk as (
    select s.beer_id as sid, count(*)::int as n, bool_or(s.user_id = v_uid) as mine
      from public.skals s join sel on sel.beer_id = s.beer_id
     group by s.beer_id
  ),
  rx1 as (
    select r.beer_id as rid, r.emoji, count(*)::int as n, bool_or(r.user_id = v_uid) as mine
      from public.reactions r join sel on sel.beer_id = r.beer_id
     where r.active
     group by r.beer_id, r.emoji
  ),
  rx as (
    select rx1.rid, jsonb_object_agg(rx1.emoji, rx1.n) as counts,
           coalesce(jsonb_agg(rx1.emoji order by rx1.emoji) filter (where rx1.mine), '[]'::jsonb) as mine
      from rx1 group by rx1.rid
  )
  select coalesce(json_agg(json_strip_nulls(json_build_object(
           'id',          case when sel.is_mine or sel.is_friend then to_json(sel.beer_id) else to_json(sel.pin_id) end,
           'lat',         sel.lat,
           'lng',         sel.lng,
           'snap',        sel.snap,
           'bar_id',      sel.bar_id,
           'precise',     sel.precise,
           'beer_count',  sel.beer_count,
           'other_count', nullif(sel.other_count, 0),
           'other_kind',  case when sel.other_count > 0 then sel.other_kind end,
           'created_at',  sel.created_at,
           'is_mine',     case when sel.is_mine then true end,
           'is_friend',   case when sel.is_friend then true end,
           'friend_name', case when sel.is_mine then null else sel.friend_name end,
           'skal_count',  sk.n,
           'i_skaled',    case when sk.mine then true end,
           'rx',          rx.counts,
           'my_rx',       case when rx.mine <> '[]'::jsonb then rx.mine end,
           'total',       case when sel.is_mine or sel.is_friend then public.olnu_lifetime(
                            (select b.user_id from public.beers b where b.id = sel.beer_id)) end,
           'meriter',     case when sel.is_mine or sel.is_friend then public.olnu_meriter(
                            (select b.user_id from public.beers b where b.id = sel.beer_id)) end
         )) order by sel.created_at, sel.pin_id), '[]'::json),
         coalesce(max(sel.nstr), 0)
    into v_pins, v_n_str
    from sel
    left join sk on sk.sid = sel.beer_id
    left join rx on rx.rid = sel.beer_id;

  select * into v_row from public.beers b where b.user_id = v_uid and b.expires_at > now();
  v_me := public.my_stats()::jsonb || jsonb_build_object(
    'id',           v_row.id,
    'beer_count',   coalesce(v_row.beer_count, 0),
    'other_count',  coalesce(v_row.other_count, 0),
    'other_kind',   v_row.other_kind,
    'lat',          v_row.lat,
    'lng',          v_row.lng,
    'precise',      v_row.precise,
    'hidden',       coalesce(v_row.stopped, false),
    'ghost',        coalesce(v_row.ghost, false),
    'expires_at',   v_row.expires_at,
    'beer_at',      v_row.beer_at,
    'wait_seconds', case when v_row.beer_count > 0 and v_row.beer_at > now() - interval '10 minutes'
                         then greatest(1, ceil(extract(epoch from (v_row.beer_at + interval '10 minutes' - now())))::int)
                         else 0 end,
    'undo_until',   case when v_row.beer_count > 0 and coalesce(v_row.undo_count, 0) < 3
                          and v_row.beer_at > now() - interval '2 minutes'
                          and (v_row.prev_for = v_row.beer_count or v_row.beer_count = 1)
                         then v_row.beer_at + interval '2 minutes' end,
    'undos_left',   greatest(0, 3 - coalesce(v_row.undo_count, 0)));

  v_out := json_build_object(
    'v',            1,
    'server_time',  now(),
    'full',         true,
    'ids_until',    to_timestamp((v_bucket + 1) * 600),
    'bbox',         json_build_array(v_a, v_b, v_c, v_d),
    'pins',         v_pins,
    'capped',       v_n_str > v_cap,
    'pins_in_view', v_n_str,
    'live_total',   (select count(*)::int from public.beers b
                      where b.expires_at > now() and not b.stopped
                        and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1)
                        and (b.user_id = v_uid or not public.olnu_is_test_zone(b.lat, b.lng) or (select public.olnu_is_test_user(v_uid)))),
    'me',           v_me::json,
    'checkins',     (select coalesce(json_agg(json_build_object(
                        'bar_id', c.bar_id, 'bar_name', c.bar_name, 'lat', c.lat, 'lng', c.lng,
                        'name', case when c.user_id = v_uid
                                     then (select min(mm.display_name) from public.group_members mm where mm.user_id = v_uid)
                                     else f.fname end,
                        'is_mine', c.user_id = v_uid,
                        'is_friend', c.user_id <> v_uid and f.fname is not null,
                        'created_at', case when c.user_id = v_uid or f.fname is not null then c.created_at
                                           else to_timestamp(floor(extract(epoch from c.created_at) / 900) * 900) end
                      ) order by c.created_at), '[]'::json)
                       from (select * from public.checkins c0
                              where c0.expires_at > now() and (c0.user_id = v_uid or not public.olnu_is_test_zone(c0.lat, c0.lng) or (select public.olnu_is_test_user(v_uid)))
                              order by c0.created_at limit 2000) c
                       left join lateral (
                         select min(am.display_name) as fname
                           from public.group_members am
                           join public.group_members cm on cm.group_id = am.group_id and cm.user_id = v_uid
                          where am.user_id = c.user_id and c.user_id <> v_uid
                       ) f on true
                      where c.user_id = v_uid or f.fname is not null
                         or (c.lat between v_a and v_c and c.lng between v_b and v_d)),
    'rallies',      (select coalesce(json_agg(to_json(r) order by r.created_at desc, r.id desc), '[]'::json)
                       from public.olnu_rally_rows(v_uid, null) r),
    'heat',         case when coalesce(p_heat, false) then
                      (select coalesce(json_agg(json_build_array(h.lat, h.lng, h.w)), '[]'::json)
                         from public.olnu_heat(v_a - (v_c - v_a) * 0.5, v_b - (v_d - v_b) * 0.5,
                                               v_c + (v_c - v_a) * 0.5, v_d + (v_d - v_b) * 0.5, 3000) h)
                    end
  );
  return v_out;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.safety_state(p_seen boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); s public.user_safety; v_not jsonb;
begin
  select * into s from public.user_safety x where x.user_id = v_uid;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'text', r.notice, 'at', r.handled_at) order by r.handled_at), '[]'::jsonb)
    into v_not from public.ugc_reports r where r.target = v_uid and r.notice is not null and not r.notice_seen;
  if coalesce(p_seen, false) then
    update public.ugc_reports r set notice_seen = true where r.target = v_uid and r.notice is not null and not r.notice_seen;
  end if;
  return jsonb_build_object('v', 1, 'age_ok', s.age_ok, 'age_checked_at', s.age_checked_at,
    'terms_ver', s.terms_ver, 'terms_at', s.terms_at, 'store', public.olnu_store_on(),
    'blocks', (select count(*) from public.user_blocks k where k.blocker = v_uid and k.active),
    'notices', v_not);
end; $function$

;

