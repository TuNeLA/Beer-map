-- public.olnu_push_prefs_of(p_uid uuid)
-- live md5(pg_get_functiondef) = d4f05727cfd656d463865c7f6f047d3b
CREATE OR REPLACE FUNCTION public.olnu_push_prefs_of(p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'v', 1,
    'off', coalesce(to_jsonb(p.off), '[]'::jsonb),
    'quiet_from', p.quiet_from,
    'quiet_to', p.quiet_to,
    'cap', coalesce(p.cap, 0),
    'cap_default', 15,
    'cats', to_jsonb(public.olnu_push_cats()),
    'tonight', coalesce((select r.n from public.push_rx r where r.user_id = p_uid and r.night = public.olnu_night_of(now())), 0)
  )
  from (select 1) one left join public.push_prefs p on p.user_id = p_uid
$function$;
