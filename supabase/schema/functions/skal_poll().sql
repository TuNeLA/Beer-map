-- public.skal_poll()
-- live md5(pg_get_functiondef) = 650c0da8b99637d63fd80cc80a2ae53f
CREATE OR REPLACE FUNCTION public.skal_poll()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  g record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  for g in select m.group_id from public.group_members m
             join public.skal_settings s on s.group_id = m.group_id and s.random_on
            where m.user_id = v_uid loop
    perform public.olnu_skal_auto(g.group_id, v_uid);
  end loop;
  return jsonb_build_object('v', 1, 'now', now(),
    'hours', coalesce((select jsonb_agg(public.olnu_skal_json(h, v_uid) order by h.created_at desc)
                         from public.skal_hours h
                         join public.group_members m on m.group_id = h.group_id and m.user_id = v_uid
                        where h.created_at > now() - interval '70 minutes'), '[]'::jsonb),
    'fired', coalesce((select jsonb_agg(h.id) from public.skal_hours h
                        where h.fired_by = v_uid and h.auto and not h.notified and h.created_at > now() - interval '3 minutes'), '[]'::jsonb));
end; $function$;
