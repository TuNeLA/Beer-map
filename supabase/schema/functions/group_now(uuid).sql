-- public.group_now(p_group_id uuid)
-- live md5(pg_get_functiondef) = 0fd1bddcbb9dd1b6308a9e97d2761275
CREATE OR REPLACE FUNCTION public.group_now(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_out jsonb;
  v_last jsonb;
  v_n int;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select count(*)::int into v_n from public.group_members m where m.group_id = p_group_id;
  with mem as (
    select gm.user_id, gm.display_name from public.group_members gm where gm.group_id = p_group_id
  ), live as (
    select m.user_id, m.display_name, b.beer_count, b.other_count, b.precise, b.snap_bar,
           greatest(coalesce(b.beer_at, b.created_at), coalesce(b.other_at, b.created_at), b.updated_at) as at,
           (select c.bar_name from public.checkins c where c.user_id = m.user_id and c.expires_at > now()
             order by c.created_at desc limit 1) as ci_name,
           (select c.created_at from public.checkins c where c.user_id = m.user_id and c.expires_at > now()
             order by c.created_at desc limit 1) as ci_at
      from mem m
      join public.beers b on b.user_id = m.user_id
     where b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false)
       and coalesce(b.beer_count, 0) + coalesce(b.other_count, 0) > 0
  ), rr as (
    select l.*, coalesce(l.ci_name,
             case when l.precise and l.snap_bar is not null then (select bl.name from public.bars_lite bl where bl.id = l.snap_bar) end) as place,
           case when l.ci_name is null and l.precise then l.snap_bar end as bar_id
      from live l
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', r.display_name, 'i', upper(left(btrim(coalesce(r.display_name, '?')), 1)),
           'place', r.place, 'bar_id', r.bar_id,
           'drinks', coalesce(r.beer_count, 0) + coalesce(r.other_count, 0),
           'at', greatest(r.at, coalesce(r.ci_at, r.at)), 'me', r.user_id = v_uid)
           order by greatest(r.at, coalesce(r.ci_at, r.at)) desc), '[]'::jsonb)
    into v_out from rr r;
  -- newest event tonight: a drink or a check-in (check-ins without a live pin count too)
  select x.j into v_last from (
    select jsonb_build_object('name', m.display_name, 'kind', 'checkin', 'place', c.bar_name, 'at', c.created_at, 'me', m.user_id = v_uid) as j, c.created_at as at
      from public.group_members m join public.checkins c on c.user_id = m.user_id
     where m.group_id = p_group_id and c.expires_at > now()
       and not exists (select 1 from public.beers b where b.user_id = m.user_id and coalesce(b.ghost, false) and b.expires_at > now())
    union all
    select jsonb_build_object('name', m.display_name, 'kind', case when coalesce(b.other_at, '-infinity') > coalesce(b.beer_at, '-infinity') then 'other' else 'beer' end,
             'place', case when b.precise and b.snap_bar is not null then (select bl.name from public.bars_lite bl where bl.id = b.snap_bar) end,
             'at', greatest(coalesce(b.beer_at, b.created_at), coalesce(b.other_at, b.created_at)), 'me', m.user_id = v_uid),
           greatest(coalesce(b.beer_at, b.created_at), coalesce(b.other_at, b.created_at))
      from public.group_members m join public.beers b on b.user_id = m.user_id
     where m.group_id = p_group_id and b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false)
       and coalesce(b.beer_count, 0) + coalesce(b.other_count, 0) > 0
  ) x order by x.at desc limit 1;
  return jsonb_build_object('v', 1, 'now', now(), 'members', v_n, 'out', v_out, 'last', v_last);
end;
$function$;
