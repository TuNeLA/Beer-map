-- public.redeem_recovery(p_code text)
-- live md5(pg_get_functiondef) = acd7afa3cdef4fee972b3ff315838e18
CREATE OR REPLACE FUNCTION public.redeem_recovery(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := public.olnu_uid(); c public.recovery_codes; n int;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select * into c from public.recovery_codes where code = upper(replace(trim(coalesce(p_code, '')), ' ', '')) for update;
  if not found or c.used_at is not null or c.expires_at < now() then raise exception 'bad_code'; end if;
  if c.old_uid = me then raise exception 'same_account'; end if;
  n := public.olnu_move_user(c.old_uid, me);
  update public.recovery_codes set used_at = now(), used_by = me where code = c.code;
  return jsonb_build_object('ok', true, 'moved', n);
end $function$;
