-- public.olnu_g_sugen(p_uid uuid, p_status text, p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = 85375efcbd10522faea13d9a69dd1702
CREATE OR REPLACE FUNCTION public.olnu_g_sugen(p_uid uuid, p_status text, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_s     text := lower(btrim(coalesce(p_status, '')));
  v_old   record;
begin
  if v_s = '' then v_s := 'none'; end if;
  if v_s not in ('sugen', 'kanske', 'inte', 'none') then
    raise exception 'invalid_status';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  select * into v_old from public.game_sugen s where s.user_id = p_uid and s.night = v_night;
  if found then
    if v_old.status = v_s then
      return jsonb_build_object('status', case when v_s = 'none' then null else v_s end, 'changed', false);
    end if;
    if v_old.updated_at > p_now - interval '10 seconds' or v_old.changes >= 40 then
      raise exception 'slow_down';
    end if;
  end if;
  insert into public.game_sugen as s (user_id, night, status, updated_at) values (p_uid, v_night, v_s, p_now)
  on conflict (user_id, night) do update set status = excluded.status, updated_at = excluded.updated_at, changes = s.changes + 1;
  return jsonb_build_object('status', case when v_s = 'none' then null else v_s end, 'changed', true);
end;
$function$;
