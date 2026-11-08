-- public.set_push_prefs(p_off text[], p_quiet_from integer, p_quiet_to integer, p_cap integer)
-- live md5(pg_get_functiondef) = 033883aa3bf04dcde2ba5a73e5cd95bf
CREATE OR REPLACE FUNCTION public.set_push_prefs(p_off text[], p_quiet_from integer DEFAULT NULL::integer, p_quiet_to integer DEFAULT NULL::integer, p_cap integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v_off text[];
begin
  select coalesce(array_agg(distinct x order by x), '{}') into v_off
    from unnest(coalesce(p_off, '{}')) x where x = any(public.olnu_push_cats());
  if coalesce(array_length(p_off, 1), 0) > 20 then raise exception 'invalid_pref'; end if;
  if (p_quiet_from is null) <> (p_quiet_to is null) then raise exception 'invalid_pref'; end if;
  if p_quiet_from is not null and (p_quiet_from not between 0 and 23 or p_quiet_to not between 0 and 23 or p_quiet_from = p_quiet_to) then
    raise exception 'invalid_pref';
  end if;
  if coalesce(p_cap, 0) not in (0, 5, 10, 20, 99) then raise exception 'invalid_pref'; end if;
  insert into public.push_prefs (user_id, off, quiet_from, quiet_to, cap, updated_at)
  values (v_uid, v_off, p_quiet_from, p_quiet_to, coalesce(p_cap, 0), now())
  on conflict (user_id) do update set off = excluded.off, quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to,
    cap = excluded.cap, updated_at = now();
  return public.olnu_push_prefs_of(v_uid);
end $function$;
