-- public.close_remind_set(p_bar_id text, p_bar_name text, p_close_at timestamp with time zone)
-- live md5(pg_get_functiondef) = ec57a1a73d9f9929f6516b6cebebf383
CREATE OR REPLACE FUNCTION public.close_remind_set(p_bar_id text, p_bar_name text, p_close_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v_name text := left(nullif(trim(coalesce(p_bar_name, '')), ''), 60);
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 then raise exception 'invalid_bar'; end if;
  if p_close_at is null or p_close_at < now() + interval '1 minute' or p_close_at > now() + interval '8 hours' then
    raise exception 'invalid_time';
  end if;
  insert into public.close_reminders (user_id, bar_id, bar_name, close_at, updated_at)
  values (v_uid, p_bar_id, v_name, date_trunc('minute', p_close_at), now())
  on conflict (user_id) do update set
    sent20 = case when public.close_reminders.bar_id = excluded.bar_id
                   and abs(extract(epoch from public.close_reminders.close_at - excluded.close_at)) < 120 then public.close_reminders.sent20 else false end,
    sent10 = case when public.close_reminders.bar_id = excluded.bar_id
                   and abs(extract(epoch from public.close_reminders.close_at - excluded.close_at)) < 120 then public.close_reminders.sent10 else false end,
    bar_id = excluded.bar_id, bar_name = excluded.bar_name, close_at = excluded.close_at, updated_at = now();
  return jsonb_build_object('ok', true);
end; $function$;
