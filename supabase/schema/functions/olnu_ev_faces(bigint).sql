-- public.olnu_ev_faces(p_inv bigint)
-- live md5(pg_get_functiondef) = ec739ad3c7f1dc58b25acdc7afc2ba6c
CREATE OR REPLACE FUNCTION public.olnu_ev_faces(p_inv bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(f.i), '[]'::jsonb) from (
    select upper(left(btrim(coalesce(public.olnu_friend_name(p.user_id), '?')), 1)) as i
      from public.invite_people p join public.invites i on i.id = p.invite_id
     where p.invite_id = p_inv and p.answer = 'yes'
     order by (p.user_id = i.creator) desc, p.answered_at nulls last
     limit 4) f;
$function$;
