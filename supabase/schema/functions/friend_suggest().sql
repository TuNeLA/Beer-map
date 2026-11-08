-- public.friend_suggest()
-- live md5(pg_get_functiondef) = 8ef7c8ee655cd104022368ad5b05a261
CREATE OR REPLACE FUNCTION public.friend_suggest()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_sug_k(v_uid, s.uid),
           'name', public.olnu_card_first(public.olnu_friend_name(s.uid)), 'mutual', s.mutual, 'group', s.g)
           order by s.score desc, s.mutual desc), '[]'::jsonb)
    into v
    from (select r.*, (case when r.g is not null then 6 else 0 end) + r.mutual * 2 + least(r.bars, 3) as score
            from public.olnu_sug_rows2(v_uid) r
           order by (case when r.g is not null then 6 else 0 end) + r.mutual * 2 + least(r.bars, 3) desc limit 8) s;
  return jsonb_build_object('v', 1, 'people', v);
end;
$function$;
