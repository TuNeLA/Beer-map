-- public.mt_close(p_round_id bigint)
-- live md5(pg_get_functiondef) = 08b0201aceadeab2959fa0c92587f829
CREATE OR REPLACE FUNCTION public.mt_close(p_round_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  r public.gang_mt_rounds;
begin
  update public.gang_mt_rounds x set closed_at = coalesce(x.closed_at, now())
   where x.id = p_round_id and x.user_id = v_uid
  returning * into r;
  if not found then raise exception 'round_not_found'; end if;
  return public.olnu_gang_mt_json(r, v_uid);
end; $function$;
