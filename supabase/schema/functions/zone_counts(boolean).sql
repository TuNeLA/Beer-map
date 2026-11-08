-- public.zone_counts(p_test boolean)
-- live md5(pg_get_functiondef) = ad8c2433e09a303780d736bae3dc32ce
CREATE OR REPLACE FUNCTION public.zone_counts(p_test boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_test boolean := coalesce(p_test, false) and public.olnu_is_test_user(auth.uid());
  v_id int := case when v_test then 2 else 1 end;
  v_ttl interval := case when v_test then interval '5 seconds' else interval '60 seconds' end;
  v jsonb;
begin
  select c.data into v from public.olnu_zone_cache c where c.id = v_id and c.at > now() - v_ttl;
  if v is not null then return v::json; end if;
  if not pg_try_advisory_xact_lock(873221, v_id) then   -- someone is building it right now: take the last one
    select c.data into v from public.olnu_zone_cache c where c.id = v_id;
    if v is not null then return v::json; end if;
  end if;
  v := public.olnu_zone_build(v_test);
  insert into public.olnu_zone_cache (id, at, data) values (v_id, now(), v)
  on conflict (id) do update set at = excluded.at, data = excluded.data;
  return v::json;
end;
$function$;
