-- public.owner_feedback(p_key text)
-- live md5(pg_get_functiondef) = 8693c1d678c62aa064c7f7e6de9a5552
CREATE OR REPLACE FUNCTION public.owner_feedback(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'counts', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select f.kind, count(*) n from public.app_feedback f
                where not public.olnu_is_test_user(f.user_id) group by 1) x),
    'morning', (select coalesce(jsonb_object_agg(answer, n), '{}'::jsonb) from (select f.answer, count(*) n from public.app_feedback f
                where f.kind = 'morning' and not public.olnu_is_test_user(f.user_id) and f.created_at > now() - interval '30 days' group by 1) x),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'body', f.body, 'answer', f.answer, 'meta', f.meta,
               'status', f.status, 'created_at', f.created_at, 'test', public.olnu_is_test_user(f.user_id)) order by f.id desc)
              from (select * from public.app_feedback x where x.status <> 'dold' order by x.id desc limit 300) f), '[]'::jsonb),
    'ikvall', (select jsonb_build_object('tonight', count(*) filter (where s.night = public.olnu_night_of(now())),
                'ute', count(*) filter (where s.night = public.olnu_night_of(now()) and s.st = 'ute')) from public.ikvall_status s));
end; $function$;
