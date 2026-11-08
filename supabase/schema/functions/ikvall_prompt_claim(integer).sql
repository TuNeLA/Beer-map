-- public.ikvall_prompt_claim(p_limit integer)
-- live md5(pg_get_functiondef) = 3d3e3be9d95540e15af946f8ccf20ee6
CREATE OR REPLACE FUNCTION public.ikvall_prompt_claim(p_limit integer DEFAULT 500)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_l timestamp := now() at time zone 'Europe/Stockholm';
  v_night timestamptz := public.olnu_night_of(now());
begin
  if extract(isodow from v_l) not in (5, 6) or v_l::time < time '20:00' or v_l::time >= time '22:30' then return; end if;
  return query
  with c as (
    select p.user_id from public.ikvall_prompt p
     where p.enabled and p.sent_night is distinct from v_night
       and not exists (select 1 from public.ikvall_status s where s.user_id = p.user_id and s.night = v_night)
       and exists (select 1 from public.push_subscriptions ps where ps.user_id = p.user_id)
       and not public.olnu_is_test_user(p.user_id)
     order by p.user_id
     limit greatest(1, least(2000, coalesce(p_limit, 500)))
     for update skip locked
  )
  update public.ikvall_prompt p set sent_night = v_night, sent_at = now()
    from c where p.user_id = c.user_id
  returning p.user_id;
end $function$;
