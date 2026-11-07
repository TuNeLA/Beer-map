-- Öl Nu — 📨 EVENT = TILLFÄLLIG GRUPP (CONTRACT "📨 EVENTGRUPPEN"). Every user-made event (invite + its temp group, 0084) is now a
-- full temporary group: the chat (as before) + the group page "+" actions that make sense for one night:
--   🎲 Partyspel (party_create / party_group / party_join), 🎲 Vem bjuder? + 💸 Kvällens nota (rnd_*), 🎉 Förfestläget (client only).
-- Still NOT a group_members row (the 0084 guard stays), so temp groups stay out of friend lists, duels, leagues, boards, crew, gang,
-- chief, skål, film, ceremonies, my_groups — exactly as before.
-- Who may play / pay = the temp group's WRITE access (olnu_tg_access: creator + ✅ yes + 🤔 maybe, until open_until, not cancelled).
-- After the event it is saved like a night out: my_past_events() (Tidigare event) + event_story() (same json as group_night_story,
-- so the client draws the same Morgontidningen) for everyone who came (creator + yes + maybe), also after hide_at (no time limit
-- other than 365 days). night_story_photo also serves an event's photos to the people who came (35 days, while bytes exist).
-- Additive: CREATE OR REPLACE with the same signatures and return shapes; new functions; no table change.

-- creator + yes + maybe, ever (for the history and the recap)
create or replace function public.olnu_evg_was(p_gid uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and exists (
    select 1 from public.temp_groups t join public.invites i on i.id = t.invite_id
     where t.group_id = p_gid
       and (i.creator = p_uid or exists (select 1 from public.invite_people p where p.invite_id = i.id and p.user_id = p_uid and p.answer in ('yes', 'maybe'))));
$$;

-- may play / pay now (= chat write access of the temp group)
create or replace function public.olnu_evg_member(p_gid uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and exists (select 1 from public.temp_groups t where t.group_id = p_gid)
     and coalesce(public.olnu_tg_access(p_gid, p_uid), 'none') = 'write';
$$;

-- the people of an event group: creator + yes + maybe (name from user_names / a group name)
create or replace function public.olnu_evg_people(p_gid uuid)
returns table (user_id uuid, name text, answer text, creator boolean, ord timestamptz)
language sql stable security definer set search_path = public as $$
  select p.user_id, coalesce(public.olnu_friend_name(p.user_id), '?'), p.answer, p.user_id = i.creator,
         coalesce(p.answered_at, p.created_at)
    from public.temp_groups t
    join public.invites i on i.id = t.invite_id
    join public.invite_people p on p.invite_id = i.id
   where t.group_id = p_gid and (p.answer in ('yes', 'maybe') or p.user_id = i.creator);
$$;

/* ---------- 💸 Rundan (0116–0118): the four helpers + rnd_group read the event people too ---------- */
create or replace function public.olnu_rnd_member(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid)
      or public.olnu_evg_member(p_group, p_uid);
$$;

create or replace function public.olnu_rnd_name(p_group uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = p_uid),
                  (select e.name from public.olnu_evg_people(p_group) e where e.user_id = p_uid limit 1), '?');
$$;

create or replace function public.olnu_rnd_uid_of(p_group uuid, p_k text)
returns uuid language sql stable security definer set search_path = public as $$
  select x.user_id from (
    select m.user_id from public.group_members m where m.group_id = p_group
    union
    select e.user_id from public.olnu_evg_people(p_group) e
  ) x where public.olnu_rnd_k(p_group, x.user_id) = p_k limit 1;
$$;

create or replace function public.rnd_group(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not public.olnu_rnd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  return jsonb_build_object(
    'v', 1, 'server_time', now(), 'night', public.olnu_night_of(now()),
    'me', public.olnu_rnd_k(p_group_id, v_uid),
    'my_swish', (select s.number from public.rnd_swish s where s.user_id = v_uid),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'k', public.olnu_rnd_k(p_group_id, m.user_id), 'name', m.display_name, 'is_me', m.user_id = v_uid,
        'out', exists (select 1 from public.beers b where b.user_id = m.user_id and b.expires_at > now() and not coalesce(b.stopped, false)),
        'swish', public.olnu_rnd_swish_of(p_group_id, m.user_id),
        'paid_n', public.olnu_rnd_paid_n(p_group_id, m.user_id),
        'net', public.olnu_rnd_net(p_group_id, m.user_id)) order by m.joined_at)
      from (select g.user_id, g.display_name, g.joined_at from public.group_members g where g.group_id = p_group_id
            union all
            select e.user_id, e.name, e.ord from public.olnu_evg_people(p_group_id) e
             where not exists (select 1 from public.group_members g2 where g2.group_id = p_group_id and g2.user_id = e.user_id)) m), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(public.olnu_rnd_exp_json(x, v_uid) order by x.id desc) from (
        select e.* from public.rnd_expenses e
         where e.group_id = p_group_id and e.created_at > now() - interval '14 days'
         order by e.id desc limit 40) x), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'from', public.olnu_rnd_k(p_group_id, p.from_user), 'from_name', public.olnu_rnd_name(p_group_id, p.from_user),
        'to', public.olnu_rnd_k(p_group_id, p.to_user), 'to_name', public.olnu_rnd_name(p_group_id, p.to_user),
        'amount', p.amount, 'expense_id', p.expense_id, 'created_at', p.created_at,
        'confirmed', p.confirmed_at is not null, 'rejected', p.rejected_at is not null,
        'from_me', p.from_user = v_uid, 'to_me', p.to_user = v_uid,
        'can_undo', p.created_by = v_uid and p.confirmed_at is null and p.rejected_at is null and p.created_at > now() - interval '24 hours',
        'can_confirm', p.to_user = v_uid and p.confirmed_at is null and p.rejected_at is null) order by p.id desc)
      from (select * from public.rnd_payments q
             where q.group_id = p_group_id and q.cancelled_at is null and q.created_at > now() - interval '14 days'
             order by q.id desc limit 40) p), '[]'::jsonb));
end; $$;

/* ---------- 🎲 Partyspel (0070–0072): a temp group's people may open / see / join its room ---------- */
create or replace function public.party_create(p_group_id uuid default null, p_name text default null, p_game text default 'imposter')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid(); v_name text; v_code text; v_id uuid; v_try int := 0; v_gname text;
  v_abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
begin
  if p_game is null or p_game not in ('imposter', 'survivor', 'hatten', 'flocken', 'vagen') then raise exception 'invalid_game'; end if;
  if p_group_id is not null then
    select gm.display_name into v_gname from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid;
    if not found then
      if public.olnu_evg_member(p_group_id, v_uid) then v_gname := public.olnu_friend_name(v_uid);
      else raise exception 'not_member'; end if;
    end if;
  end if;
  v_name := public.olnu_party_name(coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_gname));
  if v_name is null then raise exception 'invalid_name'; end if;
  if not public.olnu_party_lim(v_uid, 'create', 15, interval '1 hour') then raise exception 'slow_down'; end if;
  update public.party_rooms set closed = true, v = v + 1, updated_at = now()
   where host = v_uid and not closed and expires_at > now();
  loop
    v_try := v_try + 1;
    v_code := '';
    for i in 1..4 loop v_code := v_code || substr(v_abc, 1 + floor(random() * length(v_abc))::int, 1); end loop;
    exit when not exists (select 1 from public.party_rooms r where r.code = v_code and not r.closed and r.expires_at > now());
    if v_try > 40 then raise exception 'busy'; end if;
  end loop;
  insert into public.party_rooms (code, host, group_id, game) values (v_code, v_uid, p_group_id, p_game) returning id into v_id;
  insert into public.party_players (room_id, user_id, k, name, is_host, status, ord)
  values (v_id, v_uid, public.olnu_party_k(v_id, v_uid), v_name, true, 'in', 0);
  return public.olnu_party_view(v_id, v_uid);
end; $$;

create or replace function public.party_group(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.party_rooms; v_n int; v_in boolean; v_host text;
begin
  if not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid)
     and not public.olnu_evg_member(p_group_id, v_uid) then
    raise exception 'not_member';
  end if;
  select * into r from public.party_rooms where group_id = p_group_id and not closed and expires_at > now()
   order by created_at desc limit 1;
  if r.id is null then return jsonb_build_object('room', null); end if;
  select count(*) filter (where p.status <> 'left'), bool_or(p.user_id = v_uid and p.status <> 'left')
    into v_n, v_in from public.party_players p where p.room_id = r.id;
  select p.name into v_host from public.party_players p where p.room_id = r.id and p.user_id = r.host;
  return jsonb_build_object('room', jsonb_build_object('id', r.id, 'code', r.code, 'game', r.game, 'phase', r.phase,
    'n', v_n, 'host_name', v_host, 'is_in', coalesce(v_in, false), 'is_host', r.host = v_uid, 'expires_at', r.expires_at));
end; $$;

create or replace function public.party_join(p_code text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid(); v_code text; r public.party_rooms; v_name text; v_gname text; v_n int; v_old public.party_players;
  v_base text; v_i int := 1;
begin
  if not public.olnu_party_lim(v_uid, 'join', 30, interval '10 minutes') then raise exception 'slow_down'; end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z]', '', 'g'));
  if length(v_code) <> 4 then raise exception 'room_not_found'; end if;
  select * into r from public.party_rooms where code = v_code and not closed and expires_at > now()
   order by created_at desc limit 1 for update;
  if r.id is null then raise exception 'room_not_found'; end if;
  select * into v_old from public.party_players where room_id = r.id and user_id = v_uid;
  if r.group_id is not null then
    select gm.display_name into v_gname from public.group_members gm where gm.group_id = r.group_id and gm.user_id = v_uid;
    if v_gname is null and public.olnu_evg_member(r.group_id, v_uid) then v_gname := public.olnu_friend_name(v_uid); end if;
  end if;
  v_name := public.olnu_party_name(coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_gname, v_old.name));
  if v_name is null then raise exception 'invalid_name'; end if;
  v_base := v_name;
  while exists (select 1 from public.party_players p where p.room_id = r.id and p.user_id <> v_uid and p.status <> 'left'
                 and lower(p.name) = lower(v_name)) loop
    v_i := v_i + 1; v_name := left(v_base, 17) || ' ' || v_i;
  end loop;
  if v_old.user_id is null then
    select count(*) into v_n from public.party_players p where p.room_id = r.id and p.status <> 'left';
    if v_n >= 16 then raise exception 'room_full'; end if;
    insert into public.party_players (room_id, user_id, k, name, status, ord)
    values (r.id, v_uid, public.olnu_party_k(r.id, v_uid), v_name, case when r.phase in ('lobby', 'end') then 'in' else 'wait' end, 900);
  else
    update public.party_players set name = v_name, seen_at = now(),
           status = case when status = 'left' then case when r.phase in ('lobby', 'end') then 'in' else 'wait' end else status end
     where room_id = r.id and user_id = v_uid;
  end if;
  update public.party_rooms set v = v + 1, updated_at = now() where id = r.id;
  return public.olnu_party_view(r.id, v_uid);
end; $$;

/* ---------- 📷 night_story_photo: also an event's photos for the people who came (35 days) ---------- */
create or replace function public.night_story_photo(p_photo_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.chat_photos;
  v_from timestamptz := ((public.olnu_night_of(now()) at time zone 'Europe/Stockholm') - interval '2 days') at time zone 'Europe/Stockholm';
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.chat_photos cp where cp.id = p_photo_id and cp.bytes is not null and cp.created_at >= now() - interval '35 days';
  if not found then raise exception 'photo_not_found'; end if;
  if exists (select 1 from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_uid) then
    if v_row.created_at < v_from then raise exception 'photo_not_found'; end if;
  elsif not public.olnu_evg_was(v_row.group_id, v_uid) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object('id', v_row.id, 'mime', v_row.mime, 'w', v_row.w, 'h', v_row.h,
    'b64', replace(encode(v_row.bytes, 'base64'), E'\n', ''));
end; $$;

/* ---------- 📨 the event group page ---------- */
create or replace function public.event_group(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  t public.temp_groups; i public.invites;
  v_acc text; v_night timestamptz;
begin
  select * into t from public.temp_groups x where x.group_id = p_group_id;
  if not found then raise exception 'not_member'; end if;
  v_acc := public.olnu_tg_access(p_group_id, v_uid);
  if coalesce(v_acc, 'none') = 'none' and not public.olnu_evg_was(p_group_id, v_uid) then raise exception 'not_member'; end if;
  select * into i from public.invites x where x.id = t.invite_id;
  v_night := public.olnu_night_of(i.starts_at);
  return jsonb_build_object('v', 1, 'now', now(), 'group_id', t.group_id, 'invite_id', i.id, 'title', i.title, 'kind', i.kind,
    'place', i.place, 'bar_id', i.bar_id, 'lat', i.lat, 'lng', i.lng, 'starts_at', i.starts_at, 'open_until', t.open_until, 'hide_at', t.hide_at,
    'night', v_night, 'evening', public.olnu_evening(v_night), 'past', now() >= v_night,
    'state', case when t.closed_at is not null or i.status <> 'open' then 'cancelled' when now() >= t.open_until then 'archived' else 'open' end,
    'can_write', coalesce(v_acc, 'none') = 'write', 'can_play', public.olnu_evg_member(p_group_id, v_uid),
    'mine', i.creator = v_uid,
    'my_answer', (select p.answer from public.invite_people p where p.invite_id = i.id and p.user_id = v_uid),
    'invited', (select count(*) from public.invite_people p where p.invite_id = i.id)::int,
    'people', coalesce((select jsonb_agg(jsonb_build_object('k', public.olnu_rnd_k(p_group_id, e.user_id), 'name', e.name, 'answer', e.answer,
                 'creator', e.creator, 'is_me', e.user_id = v_uid,
                 'out', exists (select 1 from public.beers b where b.user_id = e.user_id and b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false)))
               order by e.creator desc, e.answer, e.ord) from public.olnu_evg_people(p_group_id) e), '[]'::jsonb));
end; $$;
revoke all on function public.event_group(uuid) from public, anon;
grant execute on function public.event_group(uuid) to authenticated;

/* ---------- 🗂️ Tidigare event ---------- */
create or replace function public.my_past_events(p_limit int default 20)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  return jsonb_build_object('v', 1, 'now', now(), 'events', coalesce((
    select jsonb_agg(x.j order by x.s desc) from (
      select i.starts_at as s, jsonb_build_object(
        'group_id', t.group_id, 'invite_id', i.id, 'title', i.title, 'kind', i.kind, 'place', i.place, 'starts_at', i.starts_at,
        'night', public.olnu_night_of(i.starts_at), 'evening', public.olnu_evening(public.olnu_night_of(i.starts_at)),
        'mine', i.creator = v_uid,
        'people', (select count(*) from public.olnu_evg_people(t.group_id))::int,
        'names', (select coalesce(jsonb_agg(e.name order by e.creator desc, e.ord), '[]'::jsonb)
                    from (select * from public.olnu_evg_people(t.group_id) limit 8) e),
        'drinks', (select coalesce(sum(m.beers + m.others), 0)::int from public.medal_nights m
                    where m.night = public.olnu_night_of(i.starts_at) and m.user_id in (select e.user_id from public.olnu_evg_people(t.group_id) e)),
        'photos', (select count(*) from public.chat_photos cp where cp.group_id = t.group_id)::int,
        'msgs', (select count(*) from public.group_msgs gm where gm.group_id = t.group_id and left(gm.body, 1) <> chr(8291))::int) as j
        from public.temp_groups t
        join public.invites i on i.id = t.invite_id
       where i.status <> 'cancelled' and t.closed_at is null
         and now() >= public.olnu_night_of(i.starts_at)
         and i.starts_at > now() - interval '365 days'
         and (i.creator = v_uid or exists (select 1 from public.invite_people p where p.invite_id = i.id and p.user_id = v_uid and p.answer in ('yes', 'maybe')))
       order by i.starts_at desc
       limit greatest(1, least(50, coalesce(p_limit, 20)))) x), '[]'::jsonb));
end; $$;
revoke all on function public.my_past_events(int) from public, anon;
grant execute on function public.my_past_events(int) to authenticated;

/* ---------- 📰 event_story: group_night_story json for one event night and its people ---------- */
create or replace function public.event_story(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_tz constant text := 'Europe/Stockholm';
  i public.invites;
  v_end timestamptz; v_start timestamptz;
  v_uids uuid[];
  r record;
  c_key text[] := '{}'; c_bar text[] := '{}'; c_at timestamptz[] := '{}'; c_last timestamptz[] := '{}';
  c_names jsonb[] := '{}'; c_ks jsonb[] := '{}'; c_from jsonb[] := '{}';
  ii int; jj int; v_hit int;
  v_arr jsonb := '[]'::jsonb;
  v_ci jsonb; v_mem jsonb; v_hours jsonb; v_peak jsonb; v_drinks jsonb; v_skal jsonb; v_chat jsonb; v_photos jsonb;
  v_texts int; v_photos_n int; v_voice_n int; v_total int; v_first timestamptz; v_last timestamptz; v_from text; v_town text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_evg_was(p_group_id, v_uid) then raise exception 'not_member'; end if;
  select x.* into i from public.invites x join public.temp_groups t on t.invite_id = x.id where t.group_id = p_group_id;
  v_end := public.olnu_night_of(i.starts_at);
  if v_end > public.olnu_night_of(now()) then v_end := public.olnu_night_of(now()); end if;
  v_start := ((v_end at time zone v_tz) - interval '1 day') at time zone v_tz;
  select coalesce(array_agg(e.user_id), '{}') into v_uids from public.olnu_evg_people(p_group_id) e;

  -- check-ins of the people this night (one row per bar change)
  select coalesce(jsonb_agg(jsonb_build_object('at', x.at, 'k', public.olnu_gang_k(p_group_id, x.user_id),
           'name', x.nm, 'bar', x.bar_name, 'bar_id', x.bar_id, 'from_bar', x.prev_name) order by x.at), '[]'::jsonb)
    into v_ci
    from (select y.* from (
            select t.user_id, t.at, t.bar_id, coalesce(t.bar_name, '?') as bar_name, coalesce(public.olnu_friend_name(t.user_id), '?') as nm,
                   lag(coalesce(t.bar_id, t.bar_name)) over w as prev_key, lag(t.bar_name) over w as prev_name
              from public.crew_tracks t
             where t.kind = 'ci' and t.night = v_end and t.user_id = any (v_uids)
            window w as (partition by t.user_id order by t.at)) y
           where y.prev_key is distinct from coalesce(y.bar_id, y.bar_name)
           order by y.at limit 80) x;

  -- arrivals: same bar within 30 min = one arrival
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
  for ii in 1 .. least(30, coalesce(array_length(c_key, 1), 0)) loop
    select f.value #>> '{}' into v_from from jsonb_array_elements(c_from[ii]) f group by f.value #>> '{}' order by count(*) desc limit 1;
    v_arr := v_arr || jsonb_build_array(jsonb_build_object('at', c_at[ii], 'last_at', c_last[ii], 'bar', c_bar[ii], 'bar_id', c_key[ii],
      'n', jsonb_array_length(c_names[ii]), 'names', c_names[ii], 'ks', c_ks[ii], 'from_bar', v_from, 'first', ii = 1, 'met_n', 0, 'met_group', null));
    v_from := null;
  end loop;

  -- drinks: the drink log (0165) where it exists, else duel_log deltas
  with dl as (
    select d.user_id, 1 as n, d.at from public.drink_log d
     where d.user_id = any (v_uids) and d.night = v_end and d.kind <> 'checkin' and not d.undone
    union all
    select l.user_id, l.n, l.at from public.duel_log l
     where l.kind = 'drink' and l.user_id = any (v_uids) and l.at >= v_start and l.at < v_end
       and not exists (select 1 from public.drink_log d2 where d2.user_id = l.user_id and d2.night = v_end)
  ), dh as (select dl.*, date_trunc('hour', dl.at at time zone v_tz) as h from dl),
  gh as (select h, greatest(0, sum(n))::int as n from dh group by h),
  per as (select dh.user_id, greatest(0, sum(dh.n))::int as n, min(dh.at) filter (where dh.n > 0) as first_at,
                 max(dh.at) filter (where dh.n > 0) as last_at from dh group by dh.user_id),
  ph as (select x.user_id, jsonb_agg(jsonb_build_object('h', to_char(x.h, 'HH24'), 'n', x.n) order by x.h) as hours
           from (select dh.user_id, dh.h, greatest(0, sum(dh.n))::int as n from dh group by dh.user_id, dh.h) x group by x.user_id),
  ci as (select (e.value ->> 'k') as k, count(*)::int as n, count(distinct coalesce(e.value ->> 'bar_id', e.value ->> 'bar'))::int as bars,
                min((e.value ->> 'at')::timestamptz) as first_ci from jsonb_array_elements(v_ci) e group by e.value ->> 'k')
  select (select coalesce(jsonb_agg(jsonb_build_object('h', to_char(g.h, 'HH24'), 'at', g.h at time zone v_tz, 'n', g.n) order by g.h), '[]'::jsonb) from gh g),
         (select jsonb_build_object('h', to_char(g2.h, 'HH24'), 'at', g2.h at time zone v_tz, 'n', g2.n) from gh g2 order by g2.n desc, g2.h limit 1),
         (select min(first_at) from per), (select max(last_at) from per),
         coalesce(jsonb_agg(jsonb_build_object(
           'k', public.olnu_gang_k(p_group_id, e.user_id), 'name', e.name, 'is_me', e.user_id = v_uid, 'answer', e.answer, 'creator', e.creator,
           'drinks', greatest(coalesce(p.n, 0), coalesce(mn.beers + mn.others, 0)),
           'first_at', coalesce(p.first_at, mn.first_at), 'last_at', p.last_at, 'hours', coalesce(ph.hours, '[]'::jsonb),
           'checkins', coalesce(ci.n, 0), 'bars', coalesce(ci.bars, 0), 'first_ci', ci.first_ci,
           'skal_given', coalesce(an.skal_given, 0), 'skal_got', coalesce(an.skal_got, 0), 'home_at', an.home_at,
           'out', coalesce(an.out, false) or coalesce(p.n, 0) > 0 or coalesce(mn.beers + mn.others, 0) > 0 or coalesce(ci.n, 0) > 0)
           order by e.creator desc, e.name), '[]'::jsonb),
         (select a2.town from public.after_nights a2 where a2.night = v_end and a2.user_id = any (v_uids) and a2.town is not null
           group by a2.town order by count(*) desc, a2.town limit 1)
    into v_hours, v_peak, v_first, v_last, v_mem, v_town
    from public.olnu_evg_people(p_group_id) e
    left join per p on p.user_id = e.user_id
    left join ph on ph.user_id = e.user_id
    left join public.medal_nights mn on mn.user_id = e.user_id and mn.night = v_end
    left join public.after_nights an on an.user_id = e.user_id and an.night = v_end
    left join ci on ci.k = public.olnu_gang_k(p_group_id, e.user_id);

  select coalesce(sum((x.value ->> 'drinks')::int), 0)::int into v_total from jsonb_array_elements(v_mem) x;
  v_drinks := jsonb_build_object('total', v_total, 'hours', coalesce(v_hours, '[]'::jsonb), 'peak', v_peak, 'first_at', v_first, 'last_at', v_last);
  select jsonb_build_object('total', coalesce(sum((x.value ->> 'skal_given')::int), 0)::int,
           'top', (select jsonb_build_object('name', y.value ->> 'name', 'n', (y.value ->> 'skal_given')::int)
                     from jsonb_array_elements(v_mem) y where (y.value ->> 'skal_given')::int > 0
                    order by (y.value ->> 'skal_given')::int desc, y.value ->> 'name' limit 1))
    into v_skal from jsonb_array_elements(v_mem) x;

  -- chat highlights of the event chat (no system lines, no photo rows, no tips)
  with msgs as (
    select gm.id, gm.body, gm.created_at, coalesce(public.olnu_friend_name(gm.user_id), '?') as nm
      from public.group_msgs gm
     where gm.group_id = p_group_id and gm.created_at < v_end + interval '12 hours'
       and left(gm.body, 1) <> chr(8291) and gm.body not like '📷%' and gm.body not like '📣%' and gm.body <> '🗑️'
  ), sc as (
    select ms.*,
      (select count(*) from public.group_msg_reacts x where x.msg_id = ms.id and x.active)::int
      + (select count(*) from public.group_msg_likes x where x.msg_id = ms.id and x.liked)::int as score,
      (select x.emoji from public.group_msg_reacts x where x.msg_id = ms.id and x.active group by x.emoji order by count(*) desc, x.emoji limit 1) as emoji
      from msgs ms
  )
  select (select count(*) from msgs)::int,
         coalesce((select jsonb_agg(jsonb_build_object('name', t.nm, 'body', t.body, 'at', t.created_at, 'reacts', t.score, 'emoji', t.emoji)
                                    order by t.score desc, t.created_at)
                     from (select * from sc order by sc.score desc, (char_length(sc.body) between 6 and 90) desc, sc.created_at desc limit 6) t), '[]'::jsonb)
    into v_texts, v_chat;

  select count(*)::int into v_photos_n from public.chat_photos cp where cp.group_id = p_group_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'by', p.nm, 'at', p.created_at, 'w', p.w, 'h', p.h,
           'reacts', p.score, 'caption', nullif(p.caption, ''), 'status', false) order by p.score desc, p.created_at desc), '[]'::jsonb)
    into v_photos
    from (select cp.id, cp.created_at, cp.w, cp.h, coalesce(public.olnu_friend_name(cp.user_id), '?') as nm,
                 coalesce((select count(*) from public.group_msg_reacts x where x.msg_id = cp.msg_id and x.active), 0)::int
                 + coalesce((select count(*) from public.group_msg_likes x where x.msg_id = cp.msg_id and x.liked), 0)::int as score,
                 btrim(regexp_replace(coalesce((select gm.body from public.group_msgs gm where gm.id = cp.msg_id), ''), '^📷\s*', '')) as caption
            from public.chat_photos cp
           where cp.group_id = p_group_id and cp.bytes is not null and cp.created_at > now() - interval '35 days'
           order by 6 desc, cp.created_at desc limit 4) p;
  select count(*)::int into v_voice_n from public.voice_msgs vm where vm.group_id = p_group_id;

  return jsonb_build_object('v', 1, 'night', v_end, 'evening', public.olnu_evening(v_end), 'from', v_start, 'to', v_end,
    'group_name', i.title, 'town', v_town,
    'ready', v_total > 0 or jsonb_array_length(v_ci) > 0 or v_texts > 0 or v_photos_n > 0,
    'members', v_mem, 'checkins', v_ci, 'arrivals', v_arr, 'rallies', '[]'::jsonb, 'drinks', v_drinks,
    'skal', v_skal, 'status', '[]'::jsonb, 'duels', '[]'::jsonb,
    'chat', jsonb_build_object('texts', v_texts, 'top', v_chat),
    'photos', v_photos, 'photos_n', v_photos_n, 'voice_n', v_voice_n,
    'event', jsonb_build_object('group_id', p_group_id, 'invite_id', i.id, 'title', i.title, 'kind', i.kind, 'place', i.place,
                                'bar_id', i.bar_id, 'starts_at', i.starts_at));
end; $$;
revoke all on function public.event_story(uuid) from public, anon;
grant execute on function public.event_story(uuid) to authenticated;

revoke all on function public.olnu_evg_was(uuid, uuid) from public, anon, authenticated;
revoke all on function public.olnu_evg_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.olnu_evg_people(uuid) from public, anon, authenticated;
