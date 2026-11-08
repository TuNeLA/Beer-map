-- public.rnd_set_swish(p_number text)
-- live md5(pg_get_functiondef) = 4a044b580584a8a51dc89e6cfaa690c3
CREATE OR REPLACE FUNCTION public.rnd_set_swish(p_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v text := public.olnu_rnd_swish_norm(p_number);
  v_today date := (now() at time zone 'Europe/Stockholm')::date;
  r public.rnd_swish;
begin
  if v is null then raise exception 'invalid_swish'; end if;
  if v = '' then v := null; end if;
  select * into r from public.rnd_swish s where s.user_id = v_uid for update;
  if found and r.day = v_today and r.day_changes >= 10 then raise exception 'slow_down'; end if;
  insert into public.rnd_swish (user_id, number, changes, day, day_changes) values (v_uid, v, 1, v_today, 1)
  on conflict (user_id) do update set number = excluded.number, changes = public.rnd_swish.changes + 1,
    day_changes = case when public.rnd_swish.day = v_today then public.rnd_swish.day_changes + 1 else 1 end,
    day = v_today, updated_at = now();
  return jsonb_build_object('number', v);
end; $function$;
