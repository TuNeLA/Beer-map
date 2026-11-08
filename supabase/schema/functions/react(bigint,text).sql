-- public.react(p_beer_id bigint, p_emoji text)
-- live md5(pg_get_functiondef) = aaeac47834cccd6e105a31f20c37e6f4
CREATE OR REPLACE FUNCTION public.react(p_beer_id bigint, p_emoji text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v_owner uuid; v_counts json; v_mine json;
begin
  if p_emoji is null or p_emoji not in ('🔥', '😂', '💀', '💪') then raise exception 'invalid_emoji'; end if;
  select b.user_id into v_owner from public.beers b where b.id = p_beer_id and b.expires_at > now() and not b.stopped;
  if not found then raise exception 'beer_not_found'; end if;
  if v_owner = v_uid then raise exception 'own_beer'; end if;
  insert into public.reactions (beer_id, user_id, emoji) values (p_beer_id, v_uid, p_emoji)
  on conflict (beer_id, user_id, emoji) do update set active = not public.reactions.active, updated_at = now();
  select coalesce(json_object_agg(c.emoji, c.cnt), '{}'::json) into v_counts
    from (select r.emoji, count(*)::int as cnt from public.reactions r where r.beer_id = p_beer_id and r.active group by r.emoji) c;
  select coalesce(json_agg(r.emoji order by r.emoji), '[]'::json) into v_mine
    from public.reactions r where r.beer_id = p_beer_id and r.user_id = v_uid and r.active;
  return json_build_object('counts', v_counts, 'mine', v_mine);
end; $function$;
