-- public.olnu_medal_eval_games(p_uid uuid)
-- live md5(pg_get_functiondef) = 941240ccf0d4d53b8baf7b9a7c33c7dd
CREATE OR REPLACE FUNCTION public.olnu_medal_eval_games(p_uid uuid)
 RETURNS TABLE(medal text, n integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_m int := 0; v_m3 int := 0; v_r int := 0; v_d int := 0; v_s int := 0; v_o int := 0; v_b int := 0;
begin
  begin
    select count(*) into v_m from public.game_missions gm where gm.user_id = p_uid and gm.done_at is not null;
    select count(*) into v_m3 from (
      select gm.night from public.game_missions gm where gm.user_id = p_uid and gm.done_at is not null
       group by gm.night having count(*) >= 3) x;
    select count(*) into v_r from public.game_crawls k
     where k.done_at is not null
       and k.group_id in (select m.group_id from public.group_members m where m.user_id = p_uid)
       and (select count(*) from jsonb_array_elements(k.stops) s
             where exists (select 1 from public.medal_checkins mc
                            where mc.user_id = p_uid and mc.night = k.night and mc.bar_id = s->>'id')) >= 2;
    select count(*) into v_d from public.game_agent_votes v
      join public.game_agents a on a.group_id = v.group_id and a.night = v.night
     where v.voter = p_uid and v.suspect = a.agent and a.revealed_at is not null;
    select count(*) into v_s from public.game_agents a
     where a.agent = p_uid and a.revealed_at is not null and coalesce(a.correct, 0) = 0 and coalesce(a.votes, 0) >= 1;
    select count(*) into v_o from public.game_oracles o where o.user_id = p_uid;
    select count(distinct c.night) into v_b from public.game_bingo_cards c
     where c.bingo_at is not null
       and exists (select 1 from public.game_bingo_ticks t
                    where t.group_id = c.group_id and t.night = c.night and t.user_id = p_uid and t.ticked);
  exception when others then
    return;
  end;
  return query
  select v.medal, v.n from (values
    ('uppdrag', v_m), ('uppdrag3', v_m3), ('runda', v_r), ('detektiv', v_d),
    ('spion', v_s), ('orakel', v_o), ('bingo', v_b)
  ) as v(medal, n);
end;
$function$;
