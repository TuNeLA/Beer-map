-- public.mark_home()
-- live md5(pg_get_functiondef) = b0b5355c73cd621a04700d1e99ada329
CREATE OR REPLACE FUNCTION public.mark_home()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_b   record;
  v_at  timestamptz;
begin
  select b.expires_at, b.lat, b.lng into v_b from public.beers b
   where b.user_id = v_uid and b.expires_at > now() and (b.beer_count >= 1 or coalesce(b.other_count, 0) >= 1);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_night');
  end if;
  insert into public.after_nights as a (user_id, night, town, out, home_at)
  values (v_uid, v_b.expires_at, public.olnu_town_of(v_b.lat, v_b.lng), true, now())
  on conflict (user_id, night) do update set home_at = coalesce(a.home_at, now()), out = true
  returning a.home_at into v_at;
  update public.medal_nights mn set home = true where mn.user_id = v_uid and mn.night = v_b.expires_at and not mn.home;
  return jsonb_build_object('ok', true, 'home_at', v_at);
end;
$function$;
