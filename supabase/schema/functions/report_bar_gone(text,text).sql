-- public.report_bar_gone(p_bar_id text, p_name text)
-- live md5(pg_get_functiondef) = e9a3ea3ace37fe8bdfbf8a5e29c31e53
CREATE OR REPLACE FUNCTION public.report_bar_gone(p_bar_id text, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_pos double precision[];
  v_name text := left(nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), ''), 60);
  v_trust boolean; v_n int; v_cur text; v_hidden boolean := false; v_reason text;
begin
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 then raise exception 'invalid_bar'; end if;
  v_pos := public.olnu_area_bar_pos(p_bar_id);
  if v_pos is null then raise exception 'invalid_bar'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-gone:' || p_bar_id, 0));
  select g.status into v_cur from public.bar_gone g where g.bar_id = p_bar_id;
  if v_cur in ('hidden', 'confirmed') then
    return jsonb_build_object('ok', true, 'hidden', true, 'already', true, 'reports', public.olnu_gone_count(p_bar_id));
  end if;
  if exists (select 1 from public.bar_gone_reports r where r.bar_id = p_bar_id and r.user_id = v_uid and r.withdrawn_at is null
               and r.created_at > coalesce((select g.status_at from public.bar_gone g where g.bar_id = p_bar_id and g.status = 'undone'), '-infinity'::timestamptz)) then
    return jsonb_build_object('ok', true, 'hidden', false, 'mine', true, 'reports', public.olnu_gone_count(p_bar_id), 'need', 2);
  end if;
  if (select count(*) from public.bar_gone_reports r where r.user_id = v_uid and r.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'slow_down';
  end if;
  v_trust := exists (select 1 from public.bar_area_trusted t where t.user_id = v_uid and t.active);
  -- an older live report of mine from before an owner undo: withdraw it, the new one counts
  update public.bar_gone_reports r set withdrawn_at = now() where r.bar_id = p_bar_id and r.user_id = v_uid and r.withdrawn_at is null;
  insert into public.bar_gone_reports (bar_id, user_id, name, bar_lat, bar_lng, trusted)
  values (p_bar_id, v_uid, v_name, v_pos[1], v_pos[2], v_trust);
  v_n := public.olnu_gone_count(p_bar_id);
  if v_trust or v_n >= 2 then
    v_hidden := true; v_reason := case when v_trust then 'trusted' else 'crowd' end;
    insert into public.bar_gone (bar_id, name, bar_lat, bar_lng, status, reason, reports, hidden_at, status_at)
    values (p_bar_id, coalesce(v_name, (select max(r.name) from public.bar_gone_reports r where r.bar_id = p_bar_id and r.withdrawn_at is null),
                    (select b.name from public.bars_lite b where b.id = p_bar_id)), v_pos[1], v_pos[2], 'hidden', v_reason, v_n, now(), now())
    on conflict (bar_id) do update set status = 'hidden', reason = excluded.reason, reports = excluded.reports,
      name = coalesce(public.bar_gone.name, excluded.name), hidden_at = now(), status_at = now();
  end if;
  return jsonb_build_object('ok', true, 'hidden', v_hidden, 'trusted', v_trust, 'reports', v_n, 'need', 2);
end; $function$;
