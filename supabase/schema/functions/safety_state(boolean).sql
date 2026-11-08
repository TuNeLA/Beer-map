-- public.safety_state(p_seen boolean)
-- live md5(pg_get_functiondef) = a7e1df3596dac9eb8994671753de753e
CREATE OR REPLACE FUNCTION public.safety_state(p_seen boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); s public.user_safety; v_not jsonb;
begin
  select * into s from public.user_safety x where x.user_id = v_uid;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'text', r.notice, 'at', r.handled_at) order by r.handled_at), '[]'::jsonb)
    into v_not from public.ugc_reports r where r.target = v_uid and r.notice is not null and not r.notice_seen;
  if coalesce(p_seen, false) then
    update public.ugc_reports r set notice_seen = true where r.target = v_uid and r.notice is not null and not r.notice_seen;
  end if;
  return jsonb_build_object('v', 1, 'age_ok', s.age_ok, 'age_checked_at', s.age_checked_at,
    'terms_ver', s.terms_ver, 'terms_at', s.terms_at, 'store', public.olnu_store_on(),
    'blocks', (select count(*) from public.user_blocks k where k.blocker = v_uid and k.active),
    'notices', v_not);
end; $function$;
