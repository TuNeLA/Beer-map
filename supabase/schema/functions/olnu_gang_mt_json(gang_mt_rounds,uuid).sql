-- public.olnu_gang_mt_json(r gang_mt_rounds, p_uid uuid)
-- live md5(pg_get_functiondef) = 6cf80a7c724265941849392782c051cb
CREATE OR REPLACE FUNCTION public.olnu_gang_mt_json(r gang_mt_rounds, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with votes as (
    select v.voter, v.target from public.gang_mt_votes v
      join public.group_members m on m.group_id = r.group_id and m.user_id = v.voter
      join public.group_members t on t.group_id = r.group_id and t.user_id = v.target
     where v.round_id = r.id
  ), res as (
    select v.target, count(*)::int as n from votes v group by v.target
  )
  select jsonb_build_object(
    'id', r.id, 'q', r.q, 'created_at', r.created_at, 'ends_at', r.ends_at,
    'by', public.olnu_gang_name(r.group_id, r.user_id), 'by_me', r.user_id = p_uid,
    'votes', (select count(*) from votes)::int,
    'needed', greatest(2, (select count(*) from public.group_members m where m.group_id = r.group_id))::int,
    'my_vote', (select public.olnu_gang_k(r.group_id, v.target) from votes v where v.voter = p_uid),
    'done', public.olnu_gang_mt_done(r),
    'results', case when public.olnu_gang_mt_done(r) then coalesce((
        select jsonb_agg(jsonb_build_object('k', public.olnu_gang_k(r.group_id, x.target),
                                            'name', public.olnu_gang_name(r.group_id, x.target),
                                            'is_me', x.target = p_uid, 'n', x.n) order by x.n desc, public.olnu_gang_name(r.group_id, x.target))
          from res x), '[]'::jsonb) else null end);
$function$;
