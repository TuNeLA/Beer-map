-- public.vote_wish(p_wish_id bigint)
-- live md5(pg_get_functiondef) = 59b2ca65d796729254a519b870708551
CREATE OR REPLACE FUNCTION public.vote_wish(p_wish_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_on boolean;
  v_votes int;
begin
  if not exists (select 1 from public.feature_wishes w where w.id = p_wish_id and (w.status <> 'dold' or w.user_id = v_uid)) then
    raise exception 'wish_not_found';
  end if;
  perform public.olnu_wd_rl('wv:' || v_uid::text);
  if (select count(*) from public.wish_votes v where v.user_id = v_uid and v.updated_at > now() - interval '1 minute') >= 40 then
    raise exception 'slow_down';
  end if;
  insert into public.wish_votes (wish_id, user_id, active) values (p_wish_id, v_uid, true)
  on conflict (wish_id, user_id) do update set active = not public.wish_votes.active, updated_at = now()
  returning active into v_on;
  update public.feature_wishes w set votes = (select count(*) from public.wish_votes v where v.wish_id = w.id and v.active)
   where w.id = p_wish_id returning w.votes into v_votes;
  return jsonb_build_object('votes', v_votes, 'mine', v_on);
end; $function$;
