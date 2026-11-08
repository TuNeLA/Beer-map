-- public.olnu_find_allowed(p_viewer uuid, p_target uuid)
-- live md5(pg_get_functiondef) = d305a735a3aa77ba96112b79d769ce5c
CREATE OR REPLACE FUNCTION public.olnu_find_allowed(p_viewer uuid, p_target uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.find_reqs r
                  where ((r.from_uid = p_viewer and r.to_uid = p_target) or (r.from_uid = p_target and r.to_uid = p_viewer))
                    and r.status = 'accepted' and r.until > now())
      or exists (select 1 from public.find_share s
                  where s.user_id = p_target and s.until > now()
                    and ((s.friends and public.olnu_are_friends(p_viewer, p_target))
                      or (s.groups and public.olnu_share_group(p_viewer, p_target))))
      or exists (select 1 from public.find_pos fp
                  where fp.user_id = p_target and fp.target_uid = p_viewer and fp.expires_at > now() and fp.lat is not null);
$function$;
