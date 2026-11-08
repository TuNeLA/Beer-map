-- public.bar_photo_report(p_key text, p_reason text)
-- live md5(pg_get_functiondef) = 57d77926d3e09189471cf81cd8c93aa4
CREATE OR REPLACE FUNCTION public.bar_photo_report(p_key text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  p public.bar_photos; v_n int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into p from public.bar_photos x where x.id = public.olnu_bp_id(p_key) for update;
  if not found or not public.olnu_bp_pub(p) then raise exception 'photo_not_found'; end if;
  if p.user_id = v_uid then raise exception 'own_photo'; end if;
  if (select count(*) from public.bar_photo_reports r where r.user_id = v_uid and r.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'slow_down';
  end if;
  insert into public.bar_photo_reports (bp_id, user_id, reason)
  values (p.id, v_uid, left(nullif(btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]+', ' ', 'g')), ''), 40))
  on conflict do nothing;
  select count(*) into v_n from public.bar_photo_reports r where r.bp_id = p.id;
  update public.bar_photos
     set reports = v_n,
         hidden_at = case when v_n >= 3 and hidden_at is null then now() else hidden_at end,
         hidden_by = case when v_n >= 3 and hidden_at is null then 'reports' else hidden_by end
   where id = p.id;
  return jsonb_build_object('ok', true, 'hidden', v_n >= 3);
end; $function$;
