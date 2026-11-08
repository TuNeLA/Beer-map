-- public.olnu_g_anonymize(p_old uuid, p_new uuid)
-- live md5(pg_get_functiondef) = a409bdd28fe1bf3ad1e44673f80a2a12
CREATE OR REPLACE FUNCTION public.olnu_g_anonymize(p_old uuid, p_new uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    update public.game_missions g set user_id = p_new where g.user_id = p_old;
    update public.game_facts g set user_id = p_new where g.user_id = p_old;
    update public.game_sugen g set user_id = p_new, status = 'none' where g.user_id = p_old;
    update public.game_crawls g set user_id = p_new, closed = true where g.user_id = p_old;
    update public.game_agents g set agent = p_new where g.agent = p_old;
    update public.game_agents g set started_by = p_new where g.started_by = p_old;
    update public.game_agent_votes g set voter = p_new where g.voter = p_old;
    update public.game_agent_votes g set suspect = p_new where g.suspect = p_old;
    update public.game_guesses g set user_id = p_new, town = 'Närområdet', lat = 0, lng = 0 where g.user_id = p_old;
    update public.game_oracles g set user_id = p_new where g.user_id = p_old;
    update public.game_bingo_ticks g set user_id = p_new where g.user_id = p_old;
  exception when others then
    null;
  end;
end;
$function$;
