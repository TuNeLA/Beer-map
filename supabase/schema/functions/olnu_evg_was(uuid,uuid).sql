-- public.olnu_evg_was(p_gid uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 93b17012bb3ef9aeb6643eb5b010b1cf
CREATE OR REPLACE FUNCTION public.olnu_evg_was(p_gid uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_uid is not null and exists (
    select 1 from public.temp_groups t join public.invites i on i.id = t.invite_id
     where t.group_id = p_gid
       and (i.creator = p_uid or exists (select 1 from public.invite_people p where p.invite_id = i.id and p.user_id = p_uid and p.answer in ('yes', 'maybe'))));
$function$;
