-- 0440 🎉 games lane (GM1 + GM2, 2026-11-10). OWNER-RUN at release. Additive only: one new helper function and small
-- splices into the live function bodies (like 0342), so this file never copies (and never reverts) other changes.
-- Safe to re-run: every block checks its marker first. A missing anchor stops the block with an error (no half splice).
--
-- GM1 host handover (owner 9 Nov: "hand over host to the next player, no second room"):
--   🎉 Spel rooms   spel_act leave: the creator (= host) leaves → the first active player becomes the creator.
--                   spel_state: the creator is gone (left, or quiet > 75 s) → the first active player's own poll stores
--                   him as the creator (v + 1, so every phone redraws). spel_open into an empty room: the caller is host.
--   🎲 Party rooms  party_state: the host is gone (left, or quiet > 60 s) → the next player (seen ≤ 30 s, not a tv
--                   screen, by join order) takes over in his own poll. An old "tv only" host becomes a player.
--                   party_create: a group that already has a live room (not mine) → 'room_exists' (no second room).
-- GM2 only the host switches games:
--   spel_open switches the game only for the host; spel_act 'game' and 'start' with another game → 'not_host'.
--   party_act 'game' → only the host (before: any player while the host was away).
-- Old clients keep working: they already draw the host from creator_k / is_host, and they already know 'not_host'.

-- The host of a 🎉 Spel room: the creator while active, else the first active player (same rule as spel-ui.js hostP).
create or replace function public.olnu_spel_host(p_room uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case when r.created_by = any (a.ids) then r.created_by else a.ids[1] end
    from public.spel_rooms r, (select public.olnu_spel_active(p_room) as ids) a
   where r.id = p_room;
$$;
revoke all on function public.olnu_spel_host(uuid) from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_spel_host(uuid) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.olnu_spel_host(uuid) to service_role';
  end if;
end $g$;

-- ---------- spel_act: host-only switch (game, start with another game) + handover on leave ----------
do $mig$
declare v_def text; a text[]; b text[]; i int;
begin
  v_def := pg_get_functiondef('public.spel_act(uuid,text,text,jsonb)'::regprocedure);
  if position('gm0440' in v_def) > 0 then return; end if;
  a := array[
    E'\n  elsif p_act = ''game'' then',
    E'\n    v_game := coalesce(nullif(p_data->>''game'', ''''), r.game);',
    E'\n    update public.spel_players set status = ''left'' where room_id = p_room and user_id = v_uid;'];
  b := array[
    E'\n  elsif p_act = ''game'' then\n    if v_uid <> coalesce(public.olnu_spel_host(p_room), v_uid) then raise exception ''not_host''; end if;   -- gm0440 GM2',
    E'\n    v_game := coalesce(nullif(p_data->>''game'', ''''), r.game);\n    if v_game <> r.game and v_uid <> coalesce(public.olnu_spel_host(p_room), v_uid) then raise exception ''not_host''; end if;   -- gm0440 GM2',
    E'\n    update public.spel_players set status = ''left'' where room_id = p_room and user_id = v_uid;\n    if r.created_by = v_uid then   -- gm0440 GM1: the host leaves → the next active player is the host\n      update public.spel_rooms set created_by = coalesce((public.olnu_spel_active(p_room))[1], created_by) where id = p_room;\n    end if;'];
  for i in 1 .. array_length(a, 1) loop
    if (length(v_def) - length(replace(v_def, a[i], ''))) / length(a[i]) <> 1 then raise exception 'spel_act anchor % not found once', i; end if;
    v_def := replace(v_def, a[i], b[i]);
  end loop;
  execute v_def;
end $mig$;

-- ---------- spel_open: only the host switches the game; an empty room gets the caller as host ----------
do $mig$
declare v_def text; a text[]; b text[]; i int;
begin
  v_def := pg_get_functiondef('public.spel_open(uuid,text)'::regprocedure);
  if position('gm0440' in v_def) > 0 then return; end if;
  a := array[
    E'\n  elsif p_game is not null and r.game <> p_game and r.phase in (''lobby'', ''end'') then',
    E'\n  if r.id is null then\n    insert into public.spel_rooms'];
  b := array[
    E'\n  elsif p_game is not null and r.game <> p_game and r.phase in (''lobby'', ''end'') and v_uid = coalesce(public.olnu_spel_host(r.id), v_uid) then   -- gm0440 GM2',
    E'\n  if r.id is not null and r.created_by <> v_uid and cardinality(public.olnu_spel_active(r.id)) = 0 then   -- gm0440 GM1: an empty room → the caller hosts\n    update public.spel_rooms set created_by = v_uid where id = r.id returning * into r;\n  end if;\n  if r.id is null then\n    insert into public.spel_rooms'];
  for i in 1 .. array_length(a, 1) loop
    if (length(v_def) - length(replace(v_def, a[i], ''))) / length(a[i]) <> 1 then raise exception 'spel_open anchor % not found once', i; end if;
    v_def := replace(v_def, a[i], b[i]);
  end loop;
  execute v_def;
end $mig$;

-- ---------- spel_state: the host is gone → the first active player takes over for good ----------
do $mig$
declare v_def text; a text; b text;
begin
  v_def := pg_get_functiondef('public.spel_state(uuid,integer)'::regprocedure);
  if position('gm0440' in v_def) > 0 then return; end if;
  a := E'\n  if coalesce(p_v, 0) = r.v then return jsonb_build_object(''same'', true, ''v'', r.v); end if;';
  b := E'\n  if not (r.created_by = any (public.olnu_spel_active(p_room))) and v_uid = (public.olnu_spel_active(p_room))[1] then   -- gm0440 GM1\n    update public.spel_rooms set created_by = v_uid, v = v + 1 where id = p_room returning * into r;\n  end if;' || a;
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'spel_state anchor not found once'; end if;
  execute replace(v_def, a, b);
end $mig$;

-- ---------- party_state: the host is gone → the next player takes over (same room) ----------
do $mig$
declare v_def text; a text[]; b text[]; i int;
begin
  v_def := pg_get_functiondef('public.party_state(uuid,integer)'::regprocedure);
  if position('gm0440' in v_def) > 0 then return; end if;
  a := array[
    E'me public.party_players; v_away boolean;\nbegin',
    E'\n  if coalesce(p_v, 0) = r.v then\n    select h.status'];
  b := array[
    E'me public.party_players; v_away boolean; h0440 public.party_players; v_new0440 uuid;\nbegin',
    E'\n  -- gm0440 GM1: the host left or went quiet (> 60 s): the next player takes over, in his own poll (one writer)\n'
    || E'  select * into h0440 from public.party_players where room_id = p_room and user_id = r.host;\n'
    || E'  if h0440.user_id is null or h0440.status = ''left'' or h0440.seen_at < now() - interval ''60 seconds'' then\n'
    || E'    select p.user_id into v_new0440 from public.party_players p\n'
    || E'     where p.room_id = p_room and p.status <> ''left'' and p.user_id <> r.host and p.seen_at > now() - interval ''30 seconds''\n'
    || E'     order by (p.status = ''tv''), p.ord, p.joined_at limit 1;\n'
    || E'    if v_new0440 = v_uid then\n'
    || E'      update public.party_players set is_host = false,\n'
    || E'             status = case when status = ''tv'' then case when r.phase in (''lobby'', ''end'') then ''in'' else ''wait'' end else status end\n'
    || E'       where room_id = p_room and user_id = r.host;\n'
    || E'      update public.party_players set is_host = true where room_id = p_room and user_id = v_uid;\n'
    || E'      update public.party_rooms set host = v_uid, v = v + 1, updated_at = now() where id = p_room returning * into r;\n'
    || E'    end if;\n'
    || E'  end if;\n'
    || E'  if coalesce(p_v, 0) = r.v then\n    select h.status'];
  for i in 1 .. array_length(a, 1) loop
    if (length(v_def) - length(replace(v_def, a[i], ''))) / length(a[i]) <> 1 then raise exception 'party_state anchor % not found once', i; end if;
    v_def := replace(v_def, a[i], b[i]);
  end loop;
  execute v_def;
end $mig$;

-- ---------- party_act: only the host switches the game ----------
do $mig$
declare v_def text; a text; b text;
begin
  v_def := pg_get_functiondef('public.party_act(uuid,text,text,jsonb)'::regprocedure);
  if position('gm0440' in v_def) > 0 then return; end if;
  a := E'\n  elsif p_act = ''game'' then';
  b := a || E'\n    if not me.is_host then raise exception ''not_host''; end if;   -- gm0440 GM2';
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'party_act anchor not found once'; end if;
  execute replace(v_def, a, b);
end $mig$;

-- ---------- party_create: one live room per group (join it instead of a second room) ----------
do $mig$
declare v_def text; a text; b text;
begin
  v_def := pg_get_functiondef('public.party_create(uuid,text,text)'::regprocedure);
  if position('gm0440' in v_def) > 0 then return; end if;
  a := E'\n  if not public.olnu_party_lim(v_uid, ''create'', 15, interval ''1 hour'') then raise exception ''slow_down''; end if;';
  b := E'\n  if p_group_id is not null and exists (select 1 from public.party_rooms x where x.group_id = p_group_id and not x.closed   -- gm0440 GM1\n'
    || E'       and x.expires_at > now() and x.host <> v_uid and exists (select 1 from public.party_players q where q.room_id = x.id\n'
    || E'       and q.status <> ''left'' and q.seen_at > now() - interval ''2 minutes'')) then raise exception ''room_exists''; end if;' || a;
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'party_create anchor not found once'; end if;
  execute replace(v_def, a, b);
end $mig$;
