-- public.set_age_ok(p_birth_year integer, p_had_birthday boolean)
-- live md5(pg_get_functiondef) = 623e3e3369a94299ca5d040f9b19eab9
CREATE OR REPLACE FUNCTION public.set_age_ok(p_birth_year integer, p_had_birthday boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_year int := extract(year from (now() at time zone 'Europe/Stockholm'))::int;
  v_d int;
  v_ok boolean;
  s public.user_safety;
begin
  if p_birth_year is null or p_birth_year < 1900 or p_birth_year > v_year then raise exception 'invalid_year'; end if;
  v_d := v_year - p_birth_year;
  if v_d = 18 and p_had_birthday is null then raise exception 'need_birthday'; end if;
  v_ok := v_d > 18 or (v_d = 18 and p_had_birthday);
  select * into s from public.user_safety x where x.user_id = v_uid;
  if v_ok and s.age_ok is false and s.age_checked_at > now() - interval '24 hours' then raise exception 'age_locked'; end if;
  insert into public.user_safety as u (user_id, age_ok, age_checked_at, updated_at)
  values (v_uid, v_ok, now(), now())
  on conflict (user_id) do update set age_ok = excluded.age_ok, age_checked_at = now(), updated_at = now();
  return jsonb_build_object('age_ok', v_ok, 'age_checked_at', now());
end; $function$;
