-- public.duel_poll()
-- live md5(pg_get_functiondef) = c920b793f7673615e14386176927e389
CREATE OR REPLACE FUNCTION public.duel_poll()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  r record;
  v_list jsonb := '[]'::jsonb;
begin
  for r in
    select distinct d.id from public.duels d
      join public.group_members m on m.user_id = v_uid and (m.group_id = d.group_a or m.group_id = d.group_b)
     where (d.status in ('pending', 'active') and d.ends_at > now() - interval '16 hours')
        or (d.status = 'declined' and d.created_at > now() - interval '2 hours')
     order by d.id desc limit 40
  loop
    perform public.olnu_duel_finish(r.id);
    v_list := v_list || jsonb_build_array(public.olnu_duel_json(r.id, v_uid));
  end loop;
  return jsonb_build_object('v', 1, 'server_time', now(), 'night', public.olnu_night_of(now()),
    'open', coalesce((select jsonb_agg(o.group_id) from public.duel_open o
                       join public.group_members m on m.group_id = o.group_id and m.user_id = v_uid where o.open), '[]'::jsonb),
    'duels', v_list);
end; $function$;
