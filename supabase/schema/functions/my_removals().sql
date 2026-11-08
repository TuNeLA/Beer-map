-- public.my_removals()
-- live md5(pg_get_functiondef) = 06639f61508903297f6f4b6fc07b3bcc
CREATE OR REPLACE FUNCTION public.my_removals()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('group_name', r.group_name, 'at', r.removed_at) order by r.removed_at), '[]'::jsonb)
    into v_out
    from public.group_members_removed r
   where r.user_id = v_uid and not r.seen and r.removed_at > now() - interval '14 days'
     and not public.olnu_chief_member(r.group_id, v_uid);
  update public.group_members_removed r set seen = true where r.user_id = v_uid and not r.seen;
  return v_out;
end; $function$;
