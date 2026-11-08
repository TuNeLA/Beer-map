-- public.handover_done(p_id text)
-- live md5(pg_get_functiondef) = 02f399dc098cfb8a889629c4a2e6a486
CREATE OR REPLACE FUNCTION public.handover_done(p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  n int;
begin
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{20,64}$' then return jsonb_build_object('ok', false); end if;
  update public.handover_tickets
     set done_at = coalesce(done_at, now()), box = ''
   where id_hash = public.olnu_ho_hash(p_id) and user_id = v_uid;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end;
$function$;
