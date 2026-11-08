-- public.close_remind_claim()
-- live md5(pg_get_functiondef) = 7c3940de87cc56c7f6d38593be1aeed2
CREATE OR REPLACE FUNCTION public.close_remind_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  with c as (
    update public.close_reminders r
       set sent10 = r.sent10 or r.close_at <= now() + interval '12 minutes', sent20 = true, updated_at = now()
     where r.close_at > now() and r.close_at <= now() + interval '25 minutes'
       and ((not r.sent20 and r.close_at > now() + interval '12 minutes') or (not r.sent10 and r.close_at <= now() + interval '12 minutes'))
       and exists (select 1 from public.checkins ci where ci.user_id = r.user_id and ci.bar_id = r.bar_id and ci.expires_at > now())
    returning r.user_id, r.bar_id, r.bar_name, r.close_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('to', c.user_id, 'bar_id', c.bar_id, 'bar_name', c.bar_name, 'close_at', c.close_at,
           'min', greatest(1, ceil(extract(epoch from c.close_at - now()) / 60)::int))), '[]'::jsonb)
    into v from c;
  return v;
end; $function$;
