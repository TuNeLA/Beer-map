-- public.report_content(p_kind text, p_ref text, p_group uuid, p_k text, p_reason text, p_note text)
-- live md5(pg_get_functiondef) = 364e50ddc5c245bd02bc37241f86d892
CREATE OR REPLACE FUNCTION public.report_content(p_kind text, p_ref text DEFAULT NULL::text, p_group uuid DEFAULT NULL::uuid, p_k text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  t record;
  v_reason text := case when p_reason in ('hat','sex','hot','spam','minor','drog','annat') then p_reason else 'annat' end;
  v_note text := nullif(left(btrim(regexp_replace(coalesce(p_note, ''), '[\x00-\x1F\x7F]', ' ', 'g')), 300), '');
  v_ref text := left(coalesce(p_ref, coalesce(p_group::text, '') || ':' || coalesce(p_k, '')), 80);
  v_id bigint; v_n int; v_hidden boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_report:' || v_uid::text, 0));
  if (select count(*) from public.ugc_reports r where r.reporter = v_uid and r.created_at > now() - interval '1 hour') >= 10
     or (select count(*) from public.ugc_reports r where r.reporter = v_uid and r.created_at > now() - interval '1 day') >= 30 then
    raise exception 'slow_down';
  end if;
  select * into t from public.olnu_safety_target(v_uid, p_kind, p_ref, p_group, p_k);
  select r.id into v_id from public.ugc_reports r where r.reporter = v_uid and r.kind = p_kind and r.ref = v_ref and r.status = 'new' limit 1;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'dup', true); end if;
  insert into public.ugc_reports (reporter, target, kind, ref, group_id, reason, note, excerpt)
  values (v_uid, t.target, p_kind, v_ref, t.gid, v_reason, v_note, t.excerpt)
  returning id into v_id;
  if p_kind in ('msg', 'dm', 'photo', 'voice') then
    select count(distinct r.reporter) into v_n from public.ugc_reports r where r.kind = p_kind and r.ref = v_ref and r.status = 'new';
    if v_n >= 3 then
      perform public.olnu_safety_hide(p_kind, v_ref);
      v_hidden := true;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'dup', false, 'hidden', v_hidden);
end; $function$;
