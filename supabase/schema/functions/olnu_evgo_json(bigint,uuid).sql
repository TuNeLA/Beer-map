-- public.olnu_evgo_json(p_id bigint, p_viewer uuid)
-- live md5(pg_get_functiondef) = 7717830894cb1d8de4d872aba1d4275f
CREATE OR REPLACE FUNCTION public.olnu_evgo_json(p_id bigint, p_viewer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me public.event_going;
  v_total int; v_n int; v_who jsonb; v_start timestamptz;
begin
  select * into v_me from public.event_going g where g.event_id = p_id and g.user_id = p_viewer;
  select count(*) into v_total from public.event_going g where g.event_id = p_id and g.going;
  with c as (select uid from public.olnu_evgo_circle(p_viewer)),
       w as (select g.user_id, g.updated_at, (g.user_id = p_viewer) as me
               from public.event_going g
              where g.event_id = p_id and g.going and (g.user_id = p_viewer or g.user_id in (select uid from c)))
  select count(*)::int,
         coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(public.olnu_friend_name(y.user_id), '?'), 'me', y.me) order by y.me desc, y.updated_at)
                     from (select * from w order by w.me desc, w.updated_at limit 8) y), '[]'::jsonb)
    into v_n, v_who from w;
  select e.starts_at into v_start from public.bar_events e where e.id = p_id;
  return jsonb_build_object('id', p_id, 'mine', coalesce(v_me.going, false), 'n', v_n, 'total', v_total, 'who', v_who,
    'remind', coalesce(v_me.going, false) and v_me.reminded_at is null and v_start > now() + interval '50 minutes',
    'told', v_me.told_at is not null);
end; $function$;
