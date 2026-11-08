-- public.push_pace_due(p_gap integer, p_limit integer)
-- live md5(pg_get_functiondef) = 7249273f976a166a4de50e1a2ee49f11
CREATE OR REPLACE FUNCTION public.push_pace_due(p_gap integer DEFAULT 600, p_limit integer DEFAULT 25)
 RETURNS TABLE(uid uuid, verdict text, held_n integer, held_lines text[], held_grp text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare v_night timestamptz := public.olnu_night_of(now());
begin
  return query
  with due as (
    select p.user_id from public.push_pace p
    where p.night = v_night and p.held > 0 and cardinality(p.lines) > 0
      and p.last_at < now() - make_interval(secs => greatest(60, least(3600, coalesce(p_gap, 600))))
    order by p.last_at
    limit greatest(1, least(100, coalesce(p_limit, 25)))
    for update skip locked
  ), old as (
    select p.user_id, p.held, p.lines, p.grp from public.push_pace p join due d on d.user_id = p.user_id
  ), upd as (
    update public.push_pace p set n = p.n + 1, last_at = now(), held = 0, lines = '{}', grp = null, updated_at = now()
    from due d where p.user_id = d.user_id
    returning p.user_id
  )
  select o.user_id, 'digest'::text, o.held, o.lines, o.grp from old o join upd u on u.user_id = o.user_id;
end $function$;
