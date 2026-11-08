-- public.vote_offer(p_offer_id bigint, p_vote integer)
-- live md5(pg_get_functiondef) = 45598a7753b2f94c39b9148ffda5499e
CREATE OR REPLACE FUNCTION public.vote_offer(p_offer_id bigint, p_vote integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_o   public.bar_offers%rowtype;
  v_up  int; v_dn int; v_me int;
begin
  if p_vote is null or p_vote not in (-1, 0, 1) then raise exception 'invalid_vote'; end if;
  select * into v_o from public.bar_offers o where o.id = p_offer_id and o.expires_at > now();
  if not found then raise exception 'offer_not_found'; end if;
  if v_o.user_id = v_uid then raise exception 'own_offer'; end if;
  insert into public.bar_offer_votes as v (offer_id, user_id, vote, updated_at)
  values (p_offer_id, v_uid, p_vote, now())
  on conflict (offer_id, user_id) do update set vote = excluded.vote, updated_at = now();
  select count(*) filter (where v.vote = 1), count(*) filter (where v.vote = -1)
    into v_up, v_dn from public.bar_offer_votes v where v.offer_id = p_offer_id;
  v_me := p_vote;
  return jsonb_build_object('up', v_up, 'down', v_dn, 'mine', v_me, 'hidden', (v_dn - v_up) >= 3);
end;
$function$;
