-- public.report_bar_gone_withdraw(p_bar_id text)
-- live md5(pg_get_functiondef) = 7d025d21362cbdb9c6f200385a0c4cec
CREATE OR REPLACE FUNCTION public.report_bar_gone_withdraw(p_bar_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v_n int;
begin
  update public.bar_gone_reports r set withdrawn_at = now() where r.bar_id = p_bar_id and r.user_id = v_uid and r.withdrawn_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'withdrawn', v_n > 0);
end; $function$;
