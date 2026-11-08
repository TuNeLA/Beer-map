-- public.group_status_v3(p_group_id uuid)
-- live md5(pg_get_functiondef) = 92fe5b99295a45d0a5da7794866f7aa5
CREATE OR REPLACE FUNCTION public.group_status_v3(p_group_id uuid)
 RETURNS TABLE(name text, beers integer, others integer, other_kind text, live boolean, total integer, is_me boolean, k text, is_owner boolean, is_chief boolean, is_vice boolean, is_acting boolean, home_town text, can_remove boolean, joined_at timestamp with time zone, meriter integer, rank integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.name, s.beers, s.others, s.other_kind, s.live, s.total, s.is_me, s.k, s.is_owner, s.is_chief, s.is_vice,
         s.is_acting, s.home_town, s.can_remove, s.joined_at,
         public.olnu_meriter(gm.user_id), (select r.idx from public.olnu_rank_of(public.olnu_meriter(gm.user_id)) r)
    from public.group_status_v2(p_group_id) s
    left join public.group_members gm on gm.group_id = p_group_id and public.olnu_chief_k(p_group_id, gm.user_id) = s.k
   order by public.olnu_meriter(gm.user_id) desc nulls last, s.name   -- 0292;
$function$;
