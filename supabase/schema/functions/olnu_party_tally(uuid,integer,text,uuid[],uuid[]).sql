-- public.olnu_party_tally(p_room uuid, p_game integer, p_rk text, p_voters uuid[], p_targets uuid[])
-- live md5(pg_get_functiondef) = ea53129be67c14b1aca4eb3d562c4f36
CREATE OR REPLACE FUNCTION public.olnu_party_tally(p_room uuid, p_game integer, p_rk text, p_voters uuid[], p_targets uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with t as (
    select p.k, p.name, p.user_id from public.party_players p where p.room_id = p_room and p.user_id = any (p_targets)
  ), v as (
    select t.k, t.name from public.party_inputs i join t on t.k = i.val
     where i.room_id = p_room and i.game_no = p_game and i.rk = p_rk and i.user_id = any (p_voters) and i.user_id <> t.user_id
  ), c as (
    select t.k, t.name, (select count(*) from v where v.k = t.k)::int as n from t
  )
  select jsonb_build_object(
    'votes', coalesce((select jsonb_agg(jsonb_build_object('k', v.k, 'name', v.name) order by random()) from v), '[]'::jsonb),
    'counts', coalesce((select jsonb_agg(jsonb_build_object('k', c.k, 'name', c.name, 'n', c.n) order by c.n desc, c.name) from c), '[]'::jsonb),
    'top', coalesce((select jsonb_agg(c.k) from c where c.n > 0 and c.n = (select max(n) from c)), '[]'::jsonb),
    'n', (select count(*) from v)::int);
$function$;
