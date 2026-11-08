-- public.olnu_find_req_json(r find_reqs, p_viewer uuid)
-- live md5(pg_get_functiondef) = 62b190dfe11c5322e37545bb4b11177a
CREATE OR REPLACE FUNCTION public.olnu_find_req_json(r find_reqs, p_viewer uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('id', r.id, 'key', public.olnu_find_key(r, p_viewer), 'name', public.olnu_find_name(r, p_viewer),
    'group_name', (select g.name from public.groups g where g.id = r.group_id),
    'status', case when r.status = 'pending' and r.answer_by <= now() then 'expired'
                   when r.status in ('accepted', 'auto') and r.until <= now() then 'ended' else r.status end,
    'at', r.created_at, 'answer_by', r.answer_by, 'until', r.until, 'mine', r.from_uid = p_viewer,
    'finding', exists (select 1 from public.find_pos fp where fp.user_id = case when r.from_uid = p_viewer then r.to_uid else r.from_uid end
                        and fp.target_uid = p_viewer and fp.expires_at > now() and fp.lat is not null));
$function$;
