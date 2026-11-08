-- public.submit_wish(p_text text, p_category text, p_name text)
-- live md5(pg_get_functiondef) = 8a9c5cd515ded7c5e87f676acaf32c4c
CREATE OR REPLACE FUNCTION public.submit_wish(p_text text, p_category text DEFAULT NULL::text, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_body text := left(public.olnu_wd_clean(p_text), 501);
  v_cat text := nullif(lower(public.olnu_wd_clean(p_category)), '');
  v_name text := nullif(public.olnu_wd_clean(p_name), '');
  v_day timestamptz := date_trunc('day', now() at time zone 'Europe/Stockholm') at time zone 'Europe/Stockholm';
  v_n int;
  v_id bigint;
  v_dup boolean := false;
begin
  if char_length(v_body) < 3 or char_length(v_body) > 500 or v_body ~* '(https?://|www\.|\.(se|com|nu|net|org)\M)' then
    raise exception 'invalid_wish';
  end if;
  if v_cat is not null and v_cat not in ('kartan', 'grupper', 'chatt', 'lek', 'texter', 'annat') then raise exception 'invalid_category'; end if;
  if v_name is not null and char_length(v_name) > 30 then v_name := left(v_name, 30); end if;
  perform public.olnu_wd_rl('wish:' || v_uid::text);
  select count(*) into v_n from public.feature_wishes w where w.user_id = v_uid and w.created_at >= v_day;
  if v_n >= 5 or exists (select 1 from public.feature_wishes w where w.user_id = v_uid and w.created_at > now() - interval '15 seconds') then
    raise exception 'slow_down';
  end if;
  select w.id into v_id from public.feature_wishes w
   where lower(w.body) = lower(v_body) and w.status <> 'dold' order by w.id limit 1;
  if v_id is not null then
    v_dup := true;
  else
    insert into public.feature_wishes (user_id, name, body, category) values (v_uid, v_name, v_body, v_cat) returning id into v_id;
    v_n := v_n + 1;
  end if;
  insert into public.wish_votes (wish_id, user_id, active) values (v_id, v_uid, true)
  on conflict (wish_id, user_id) do update set active = true, updated_at = now();
  update public.feature_wishes w set votes = (select count(*) from public.wish_votes v where v.wish_id = w.id and v.active)
   where w.id = v_id;
  return jsonb_build_object('id', v_id, 'dup', v_dup, 'left_today', greatest(0, 5 - v_n),
                            'votes', (select w.votes from public.feature_wishes w where w.id = v_id));
end; $function$;
