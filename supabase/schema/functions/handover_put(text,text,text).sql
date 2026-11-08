-- public.handover_put(p_id text, p_box text, p_src text)
-- live md5(pg_get_functiondef) = 8ba186fdb75205807da3e48410c98812
CREATE OR REPLACE FUNCTION public.handover_put(p_id text, p_box text, p_src text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_exp timestamptz := now() + interval '30 minutes';
begin
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{20,64}$' then raise exception 'bad_ticket'; end if;
  if p_box is null or char_length(p_box) < 24 or char_length(p_box) > 8000 or p_box !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'bad_box';
  end if;
  if (select count(*) from public.handover_tickets t
       where t.user_id = v_uid and t.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate_limited';
  end if;
  insert into public.handover_tickets (id_hash, user_id, box, src, expires_at)
  values (public.olnu_ho_hash(p_id), v_uid, p_box, left(coalesce(p_src, ''), 16), v_exp);
  return jsonb_build_object('ok', true, 'expires_at', v_exp);
exception when unique_violation then
  raise exception 'bad_ticket';
end;
$function$;
