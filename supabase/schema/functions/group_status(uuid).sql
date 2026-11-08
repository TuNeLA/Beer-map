-- public.group_status(p_group_id uuid)
-- live md5(pg_get_functiondef) = 74e84e5e9592bae3eeb1a8979022af4e
CREATE OR REPLACE FUNCTION public.group_status(p_group_id uuid)
 RETURNS TABLE(name text, beers integer, others integer, other_kind text, live boolean, total integer, is_me boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return query
  select gm.display_name,
         coalesce(case when b.expires_at > now() then b.beer_count end, 0)::int,
         coalesce(case when b.expires_at > now() then b.other_count end, 0)::int,
         case when b.expires_at > now() then b.other_kind end,
         coalesce(b.expires_at > now() and not b.stopped, false),
         public.olnu_lifetime(gm.user_id),
         (gm.user_id = v_uid)
    from public.group_members gm
    left join public.beers b on b.user_id = gm.user_id
   where gm.group_id = p_group_id
   order by 2 desc, 3 desc, 1;
end; $function$;
