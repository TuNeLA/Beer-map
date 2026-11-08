-- public.hide_quote(p_quote_id bigint)
-- live md5(pg_get_functiondef) = 8fdcf1d02c00f3109ebc2510284be9a8
CREATE OR REPLACE FUNCTION public.hide_quote(p_quote_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  q public.gang_quotes;
begin
  select * into q from public.gang_quotes x where x.id = p_quote_id;
  if not found or not public.olnu_gang_member(q.group_id, v_uid) then raise exception 'quote_not_found'; end if;
  if q.user_id <> v_uid and lower(coalesce(public.olnu_gang_name(q.group_id, v_uid), '')) <> lower(q.who) then
    raise exception 'not_yours';
  end if;
  update public.gang_quotes x set hidden = true, hidden_by = v_uid, hidden_at = now() where x.id = q.id;
  return jsonb_build_object('ok', true);
end; $function$;
