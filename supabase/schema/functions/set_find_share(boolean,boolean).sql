-- public.set_find_share(p_groups boolean, p_friends boolean)
-- live md5(pg_get_functiondef) = 4972403ac2249714f7b8c4fa6f8c1373
CREATE OR REPLACE FUNCTION public.set_find_share(p_groups boolean, p_friends boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_on boolean := coalesce(p_groups, false) or coalesce(p_friends, false);
  s public.find_share;
begin
  insert into public.find_share (user_id, groups, friends, until, updated_at)
  values (v_uid, coalesce(p_groups, false), coalesce(p_friends, false), case when v_on then public.olnu_next_expiry() else now() end, now())
  on conflict (user_id) do update set groups = excluded.groups, friends = excluded.friends, until = excluded.until, updated_at = now()
  returning * into s;
  return jsonb_build_object('groups', s.groups and s.until > now(), 'friends', s.friends and s.until > now(),
    'until', case when s.until > now() then s.until end);
end; $function$;
