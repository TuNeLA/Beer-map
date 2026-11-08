-- public.ikvall_set(p_st text)
-- live md5(pg_get_functiondef) = 01f288c62f1b7ace6782962875814fa8
CREATE OR REPLACE FUNCTION public.ikvall_set(p_st text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_st text := nullif(lower(trim(coalesce(p_st, ''))), '');
begin
  if v_uid is null then raise exception 'not_authed'; end if;
  if v_st is not null and v_st not in ('ute', 'kanske', 'hemma') then raise exception 'invalid_status'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_ikv:' || v_uid::text, 0));
  if exists (select 1 from public.ikvall_status s where s.user_id = v_uid and s.updated_at > now() - interval '1 second') then
    raise exception 'slow_down';
  end if;
  if v_st is null then
    delete from public.ikvall_status s where s.user_id = v_uid;
  else
    insert into public.ikvall_status (user_id, night, st, updated_at) values (v_uid, public.olnu_night_of(now()), v_st, now())
    on conflict (user_id) do update set night = excluded.night, st = excluded.st, updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'st', v_st);
end; $function$;
