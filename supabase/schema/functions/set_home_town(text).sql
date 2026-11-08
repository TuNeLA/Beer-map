-- public.set_home_town(p_town text)
-- live md5(pg_get_functiondef) = 58da8c1feb5747089d89f0d88d84270d
CREATE OR REPLACE FUNCTION public.set_home_town(p_town text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_town text := public.olnu_clean_town(p_town);
  h      public.user_home;
begin
  if v_town is null then raise exception 'invalid_town'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_home:' || v_uid::text, 0));
  select * into h from public.user_home x where x.user_id = v_uid;
  if found then
    if h.updated_at > now() - interval '3 seconds' then raise exception 'slow_down'; end if;
    if h.updated_at > now() - interval '1 day' and h.changes >= 40 then raise exception 'slow_down'; end if;
    update public.user_home x
       set town = nullif(v_town, ''), updated_at = now(),
           changes = case when x.updated_at > now() - interval '1 day' then x.changes + 1 else 1 end
     where x.user_id = v_uid;
  else
    insert into public.user_home (user_id, town, updated_at, changes) values (v_uid, nullif(v_town, ''), now(), 1);
  end if;
  return jsonb_build_object('town', nullif(v_town, ''));
end; $function$;
