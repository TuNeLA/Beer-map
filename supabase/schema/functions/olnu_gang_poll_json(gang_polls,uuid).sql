-- public.olnu_gang_poll_json(p gang_polls, p_uid uuid)
-- live md5(pg_get_functiondef) = 9fa2b89e257ba91ffc2d6f8fcfb91acd
CREATE OR REPLACE FUNCTION public.olnu_gang_poll_json(p gang_polls, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with votes as (
    select v.user_id, v.opt, v.updated_at from public.gang_poll_votes v
      join public.group_members m on m.group_id = p.group_id and m.user_id = v.user_id
     where v.poll_id = p.id
  )
  select jsonb_build_object(
    'id', p.id, 'by', public.olnu_gang_name(p.group_id, p.user_id), 'by_me', p.user_id = p_uid,
    'created_at', p.created_at, 'ends_at', p.ends_at,
    'ended', p.ended_at is not null or p.ends_at <= now(), 'ended_at', coalesce(p.ended_at, case when p.ends_at <= now() then p.ends_at end),
    'winner', p.winner, 'rally_id', p.rally_id, 'rally_error', p.rally_error,
    'rally_mine', exists (select 1 from public.rallies r where r.id = p.rally_id and r.user_id = p_uid),
    'my_vote', (select v.opt from votes v where v.user_id = p_uid),
    'votes', (select count(*) from votes)::int,
    'options', coalesce((
      select jsonb_agg(o.value || jsonb_build_object(
               'i', (o.ord - 1)::int,
               'n', (select count(*) from votes v where v.opt = o.ord - 1)::int,
               'names', coalesce((select jsonb_agg(public.olnu_gang_name(p.group_id, v.user_id) order by v.updated_at)
                                    from votes v where v.opt = o.ord - 1), '[]'::jsonb)) order by o.ord)
        from jsonb_array_elements(p.options) with ordinality o(value, ord)), '[]'::jsonb));
$function$;
