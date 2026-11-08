-- public.crew_dates_create(p_group_id uuid, p_dates date[], p_title text)
-- live md5(pg_get_functiondef) = 779dab7dbb323ce6e9eb9b03f6c84cb9
CREATE OR REPLACE FUNCTION public.crew_dates_create(p_group_id uuid, p_dates date[], p_title text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_today date := public.olnu_evening(public.olnu_night_of(now()));
  v_dates date[]; v_title text := public.olnu_crew_clean(p_title, 200); v_id bigint;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  select array_agg(distinct x order by x) into v_dates from unnest(coalesce(p_dates, '{}'::date[])) x where x is not null;
  if v_dates is null or array_length(v_dates, 1) < 2 or array_length(v_dates, 1) > 5
     or v_dates[1] < v_today or v_dates[array_length(v_dates, 1)] > v_today + 90 then
    raise exception 'invalid_dates';
  end if;
  if v_title is not null and char_length(v_title) > 40 then raise exception 'invalid_msg'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_crew_dates:' || v_uid::text, 0));
  if exists (select 1 from public.crew_date_polls p where p.user_id = v_uid and p.created_at > now() - interval '2 minutes') then
    raise exception 'slow_down';
  end if;
  update public.crew_date_polls p set closed_at = now()
   where p.group_id = p_group_id and p.closed_at is null and p.ends_at > now();
  insert into public.crew_date_polls (group_id, user_id, title, dates, ends_at)
  values (p_group_id, v_uid, v_title, v_dates,
          ((v_dates[array_length(v_dates, 1)] + 1)::timestamp + interval '5 hours') at time zone 'Europe/Stockholm')
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end; $function$;
