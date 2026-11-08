-- public.rnd_spin(p_group_id uuid, p_keys text[], p_fair boolean, p_line text)
-- live md5(pg_get_functiondef) = 6adc4e357ec77f2f230aa9ac53721f1a
CREATE OR REPLACE FUNCTION public.rnd_spin(p_group_id uuid, p_keys text[], p_fair boolean DEFAULT false, p_line text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_ids uuid[] := '{}'; v_w float8[] := '{}'; v_sum float8 := 0; v_r float8; v_acc float8 := 0;
  k text; v_t uuid; v_win uuid; i int;
  v_line text := left(public.olnu_rnd_clean(p_line), 110);
  v_name text; v_body text; v_msg bigint; v_id bigint; v_out jsonb := '[]'::jsonb;
begin
  if not public.olnu_rnd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if p_keys is null or array_length(p_keys, 1) is null or array_length(p_keys, 1) < 2 or array_length(p_keys, 1) > 20 then
    raise exception 'invalid_spin';
  end if;
  foreach k in array p_keys loop
    v_t := public.olnu_rnd_uid_of(p_group_id, k);
    if v_t is null then raise exception 'invalid_member'; end if;
    if v_t = any(v_ids) then raise exception 'invalid_spin'; end if;
    v_ids := v_ids || v_t;
    v_w := v_w || (case when coalesce(p_fair, false) then 1.0 / (1 + public.olnu_rnd_paid_n(p_group_id, v_t)) else 1.0 end);
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('olnu_rnd_spin:' || v_uid::text, 0));
  if exists (select 1 from public.rnd_spins s where s.user_id = v_uid and s.created_at > now() - interval '6 seconds')
     or (select count(*) from public.rnd_spins s where s.user_id = v_uid and s.created_at > public.olnu_night_of(now()) - interval '1 day') >= 40 then
    raise exception 'slow_down';
  end if;
  for i in 1 .. array_length(v_w, 1) loop v_sum := v_sum + v_w[i]; end loop;
  v_r := random() * v_sum;
  for i in 1 .. array_length(v_w, 1) loop
    v_acc := v_acc + v_w[i];
    if v_win is null and v_r < v_acc then v_win := v_ids[i]; end if;
    v_out := v_out || jsonb_build_object('k', p_keys[i], 'pct', round((100 * v_w[i] / v_sum)::numeric)::int);
  end loop;
  if v_win is null then v_win := v_ids[array_length(v_ids, 1)]; end if;
  v_name := public.olnu_rnd_name(p_group_id, v_win);
  if v_line = '' then v_line := '{n} bjuder på nästa runda!'; end if;
  if position('{n}' in v_line) = 0 then v_line := '{n} bjuder! ' || v_line; end if;
  v_body := left('🎲 ' || replace(v_line, '{n}', v_name), 140);
  insert into public.group_msgs (group_id, user_id, body, expires_at)
  values (p_group_id, v_uid, v_body, public.olnu_next_expiry()) returning id into v_msg;
  insert into public.rnd_spins (group_id, user_id, members, winner, fair, msg_id, night)
  values (p_group_id, v_uid, v_ids, v_win, coalesce(p_fair, false), v_msg, public.olnu_night_of(now()))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'winner', public.olnu_rnd_k(p_group_id, v_win), 'winner_name', v_name,
                            'winner_me', v_win = v_uid, 'msg_id', v_msg, 'body', v_body, 'weights', v_out);
end; $function$;
