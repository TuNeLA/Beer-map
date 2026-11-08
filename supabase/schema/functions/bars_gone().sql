-- public.bars_gone()
-- live md5(pg_get_functiondef) = 37b18a6521245d526a5f1fd87a7ae8d4
CREATE OR REPLACE FUNCTION public.bars_gone()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  return jsonb_build_object('v', 1, 'server_time', now(),
    'ids', coalesce((select jsonb_agg(g.bar_id order by g.bar_id) from public.bar_gone g where g.status in ('hidden', 'confirmed')), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(distinct r.bar_id) from public.bar_gone_reports r
                       where r.user_id = v_uid and r.withdrawn_at is null and r.created_at > now() - interval '90 days'), '[]'::jsonb));
end; $function$;
