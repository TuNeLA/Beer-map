-- public.olnu_party_finish(p_room uuid, p_winners uuid[])
-- live md5(pg_get_functiondef) = 3f987d0a817102bd115af55e7b85f40a
CREATE OR REPLACE FUNCTION public.olnu_party_finish(p_room uuid, p_winners uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.party_rooms; v_n int;
begin
  select * into r from public.party_rooms where id = p_room;
  update public.party_players p set wins = p.wins + 1 where p.room_id = p_room and p.user_id = any (coalesce(p_winners, '{}'::uuid[]));
  select count(*) into v_n from public.party_players p where p.room_id = p_room and p.in_game;
  if v_n >= 3 and r.started_at is not null and r.started_at < now() - interval '60 seconds' then
    insert into public.party_results (room_id, game_no, user_id, game, won, night, players)
    select p_room, r.game_no, p.user_id, r.game, p.user_id = any (coalesce(p_winners, '{}'::uuid[])), public.olnu_night_of(now()), v_n
      from public.party_players p where p.room_id = p_room and p.in_game
    on conflict do nothing;
  end if;
  return public.olnu_party_people(p_room, coalesce(p_winners, '{}'::uuid[]));
end; $function$;
