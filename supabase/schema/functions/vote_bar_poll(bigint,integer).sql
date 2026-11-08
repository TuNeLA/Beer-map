-- public.vote_bar_poll(p_poll_id bigint, p_option integer)
-- live md5(pg_get_functiondef) = 6c7686a4f5b5c6af82f6ea73dcf4433e
CREATE OR REPLACE FUNCTION public.vote_bar_poll(p_poll_id bigint, p_option integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  p public.gang_polls;
begin
  select * into p from public.gang_polls x where x.id = p_poll_id;
  if not found or not public.olnu_gang_member(p.group_id, v_uid) then raise exception 'poll_not_found'; end if;
  if p.ended_at is not null or p.ends_at <= now() then raise exception 'poll_ended'; end if;
  if p_option is null or p_option < 0 or p_option >= jsonb_array_length(p.options) then raise exception 'invalid_option'; end if;
  insert into public.gang_poll_votes (poll_id, user_id, opt) values (p.id, v_uid, p_option)
  on conflict (poll_id, user_id) do update set opt = excluded.opt, updated_at = now();
  return public.olnu_gang_poll_json(p, v_uid);
end; $function$;
