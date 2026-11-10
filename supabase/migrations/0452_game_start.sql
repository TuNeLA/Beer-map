-- 0452 after (GM4 + GM7 Oraklet). OWNER-RUN at release, AFTER the big-update client is live (the Oraklet medal is picked up
-- by award_medals at once; an old client would show an unknown medal id). Needs 0450 + 0451. Additive only: new functions
-- and two new triggers (create or replace trigger). Safe to re-run.
--   GM4  A game starts in a group → one push to the rest of the group ("Anton startade Imposter i Gänget. Hoppa in!"):
--        🎲 Partyspel: a new party room of a group (party_rooms insert)   → url /?party=<code>
--        🎉 Spel:      a spel room leaves the lobby (spel_rooms phase)     → url /?mgame=<group>
--        Once per group per night (tag olnu-game-<group>-<evening>), never to the starter, the players already in the
--        room or a ghost night; inside the 2 game pushes per person per night (after_push_q, kind 'game'); only with
--        after_flags.game_push on. A trigger error never breaks the game (exception → nothing queued).
--   GM7  🔮 Oraklet medal: olnu_medal_eval_oraklet = right picks in Kvällens vad + Halvtid (settled rounds). It rewards the
--        prediction, never drinking. Stacks.

create or replace function public.olnu_game_start_q(p_gid uuid, p_by uuid, p_room uuid, p_kind text, p_game text, p_url text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_night timestamptz := public.olnu_night_of(public.olnu_crew_now()); v_ev text := to_char(public.olnu_evening(v_night), 'YYYYMMDD');
  v_g text; v_host text; v_game text; u uuid; n int := 0;
begin
  if p_gid is null or not public.olnu_after_on('game_push') then return 0; end if;
  if exists (select 1 from public.dm_threads t where t.group_id = p_gid) then return 0; end if;
  select left(g.name, 30) into v_g from public.groups g where g.id = p_gid;
  select left(coalesce(m.display_name, ''), 20) into v_host from public.group_members m where m.group_id = p_gid and m.user_id = p_by;
  v_game := case p_game when 'imposter' then 'Imposter' when 'survivor' then 'Östra lägret' when 'hatten' then 'Namn i hatten'
    when 'flocken' then 'Flocken' when 'vagen' then 'Vågen' else case when p_kind = 'party' then 'ett partyspel' else 'ett spel' end end;
  for u in select m.user_id from public.group_members m
            where m.group_id = p_gid and m.user_id is distinct from p_by
              and not public.olnu_after_ghost(m.user_id, v_night)
              and not exists (select 1 from public.party_players pp where p_kind = 'party' and pp.room_id = p_room and pp.user_id = m.user_id)
              and not exists (select 1 from public.spel_players sp where p_kind = 'spel' and sp.room_id = p_room and sp.user_id = m.user_id) loop
    if public.olnu_after_q_add(u, v_night, 'game', 'olnu-game-' || p_gid::text || '-' || v_ev,
         case when p_kind = 'party' then 'Partyspel pågår 🎲' else 'Spel pågår 🎉' end,
         coalesce(nullif(v_host, ''), 'Nån') || ' startade ' || v_game || ' i ' || coalesce(v_g, 'gruppen') || '. Hoppa in!', p_url, p_by, null) then n := n + 1; end if;
  end loop;
  return n;
end; $$;

create or replace function public.olnu_game_start_party_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.group_id is not null and not coalesce(new.closed, false) then
      perform public.olnu_game_start_q(new.group_id, new.host, new.id, 'party', new.game, '/?party=' || coalesce(new.code, ''));
    end if;
  exception when others then null;
  end;
  return new;
end; $$;

create or replace function public.olnu_game_start_spel_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.group_id is not null and old.phase = 'lobby' and new.phase is distinct from 'lobby' and not coalesce(new.closed, false) then
      perform public.olnu_game_start_q(new.group_id, new.created_by, new.id, 'spel', new.game, '/?mgame=' || new.group_id::text);
    end if;
  exception when others then null;
  end;
  return new;
end; $$;

create or replace trigger olnu_game_start_party after insert on public.party_rooms
  for each row execute function public.olnu_game_start_party_tg();
create or replace trigger olnu_game_start_spel after update of phase on public.spel_rooms
  for each row execute function public.olnu_game_start_spel_tg();

-- 🔮 Oraklet: right picks in settled Kvällens vad / Halvtid rounds (award_medals picks it up by name)
create or replace function public.olnu_medal_eval_oraklet(p_uid uuid)
returns table (medal text, n integer)
language sql stable security definer set search_path = public as $$
  select 'oraklet'::text, count(*)::int
    from public.moment_picks p join public.moment_rounds r on r.id = p.round_id
   where p.user_id = p_uid and r.kind in ('vad', 'halvtid') and r.answer is not null and p.pick = (r.answer ->> 'v');
$$;

revoke all on function public.olnu_game_start_q(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.olnu_game_start_party_tg() from public, anon, authenticated;
revoke all on function public.olnu_game_start_spel_tg() from public, anon, authenticated;
revoke all on function public.olnu_medal_eval_oraklet(uuid) from public, anon, authenticated;
