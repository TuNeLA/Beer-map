-- public.create_rally(p_group_id uuid, p_body text, p_place text, p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 5e83025f65a91a11a3a1cb3b35d78175
CREATE OR REPLACE FUNCTION public.create_rally(p_group_id uuid, p_body text, p_place text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_body  text := btrim(regexp_replace(coalesce(p_body, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
  v_place text := btrim(regexp_replace(coalesce(p_place, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
  v_lat   float8;
  v_lng   float8;
  v_id    bigint;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if v_body = '' then
    v_body := 'Behöver förstärkning!';
  end if;
  if char_length(v_body) > 100 or char_length(v_place) > 60 then
    raise exception 'invalid_msg';
  end if;
  if p_lat is not null and p_lng is not null
     and p_lat not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lng not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lat between -85.0 and 85.0 and p_lng between -180.0 and 180.0 then
    v_lat := round(p_lat::numeric, 5)::float8;
    v_lng := round(p_lng::numeric, 5)::float8;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('olnu_rally:' || v_uid::text, 0));
  if exists (select 1 from public.rallies r
              where r.user_id = v_uid and r.created_at > now() - interval '3 minutes') then
    raise exception 'slow_down';
  end if;

  update public.rallies set closed = true
   where user_id = v_uid and group_id = p_group_id and not closed;

  insert into public.rallies (group_id, user_id, body, place, lat, lng, expires_at)
  values (p_group_id, v_uid, v_body, nullif(v_place, ''), v_lat, v_lng, public.olnu_next_expiry())
  returning rallies.id into v_id;

  insert into public.rally_answers (rally_id, user_id, answer, notified)
  values (v_id, v_uid, 'yes', true)
  on conflict (rally_id, user_id) do update set answer = 'yes', updated_at = now(), notified = true;

  return json_build_object('id', v_id);
end;
$function$;
