-- public.claim_medal(p_medal text)
-- live md5(pg_get_functiondef) = c6c5773346d5f4c15749670da23ac3ad
CREATE OR REPLACE FUNCTION public.claim_medal(p_medal text)
 RETURNS TABLE(medal text, count integer, is_new boolean, earned_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_m   text := lower(btrim(coalesce(p_medal, '')));
begin
  if v_m not in ('vatten', 'spoke', 'dagsljus', 'uggla', 'sidospar', 'hemvarn', 'radio', 'krogrunda') then
    raise exception 'invalid_medal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_medal:' || v_uid::text, 0));
  -- Old local badges (migrated once): count only 1 per medal, ever, except "vatten" and "spoke".
  if v_m in ('vatten', 'spoke')
     or not exists (select 1 from public.medal_claims c where c.user_id = v_uid and c.medal = v_m) then
    insert into public.medal_claims (user_id, medal, night)
    values (v_uid, v_m, public.olnu_night_of(now()))
    on conflict do nothing;
  end if;
  return query select s.medal, s.count, s.is_new, s.earned_at from public.olnu_medal_store(v_uid) s;
end;
$function$;
