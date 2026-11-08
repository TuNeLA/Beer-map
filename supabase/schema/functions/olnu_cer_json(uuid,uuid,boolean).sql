-- public.olnu_cer_json(p_gid uuid, p_uid uuid, p_full boolean)
-- live md5(pg_get_functiondef) = 3000c270a7d091662816d2a65d8766ac
CREATE OR REPLACE FUNCTION public.olnu_cer_json(p_gid uuid, p_uid uuid, p_full boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now    timestamptz := public.olnu_cer_now();
  v_night  timestamptz := public.olnu_cer_night(v_now);
  v_day    date := (v_night at time zone 'Europe/Stockholm')::date;
  v_open   timestamptz := (v_day + time '06:00') at time zone 'Europe/Stockholm';
  v_close  timestamptz := (v_day + time '18:00') at time zone 'Europe/Stockholm';
  v_cats   text[] := public.olnu_cer_cats();
  v_out    uuid[];
  v_n      int := 0;
  v_done_n int := 0;
  v_me_out boolean := false;
  v_phase  text;
  v_done   record;
  v_mine   jsonb := '{}'::jsonb;
  v_my_n   int := 0;
  v_members jsonb := '[]'::jsonb;
  v_res    jsonb := null;
  v_wins   jsonb := '[]'::jsonb;
  v_done_names jsonb := '[]'::jsonb;
begin
  select coalesce(array_agg(o.user_id), '{}') into v_out from public.olnu_cer_out(p_gid, v_night) o;
  v_n := coalesce(array_length(v_out, 1), 0);
  v_me_out := p_uid = any (v_out);
  select count(*) into v_done_n from (
    select v.voter from public.cer_votes v
     where v.group_id = p_gid and v.night = v_night and v.voter = any (v_out) and v.target = any (v_out)
       and v.cat = any (v_cats)
     group by v.voter having count(*) >= array_length(v_cats, 1)) d;
  select * into v_done from public.cer_done d where d.group_id = p_gid and d.night = v_night;
  if v_n < 2 then
    v_phase := 'none';
  elsif v_done.group_id is not null then
    v_phase := 'done';
  elsif v_now >= v_close then
    perform public.olnu_cer_finish(p_gid, v_night, 'time'); v_phase := 'done';
  elsif v_now < v_open then
    v_phase := 'before';
  elsif v_done_n >= v_n then
    perform public.olnu_cer_finish(p_gid, v_night, 'all'); v_phase := 'done';
  else
    v_phase := 'open';
  end if;

  select coalesce(jsonb_object_agg(v.cat, public.olnu_cer_k(p_gid, v.target)), '{}'::jsonb), count(*)
    into v_mine, v_my_n
    from public.cer_votes v
   where v.group_id = p_gid and v.night = v_night and v.voter = p_uid and v.target = any (v_out) and v.cat = any (v_cats);

  if v_phase = 'done' then
    select coalesce(jsonb_agg(r.cat), '[]'::jsonb) into v_wins
      from public.cer_results r where r.group_id = p_gid and r.night = v_night and r.winner = p_uid;
  end if;

  if p_full then
    select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_cer_k(p_gid, o.user_id), 'name', o.name,
             'is_me', o.user_id = p_uid)), '[]'::jsonb)
      into v_members from public.olnu_cer_out(p_gid, v_night) o;
    select coalesce(jsonb_agg(gm.display_name), '[]'::jsonb) into v_done_names
      from public.group_members gm
     where gm.group_id = p_gid and gm.user_id = any (v_out)
       and (select count(*) from public.cer_votes v where v.group_id = p_gid and v.night = v_night and v.voter = gm.user_id
              and v.target = any (v_out) and v.cat = any (v_cats)) >= array_length(v_cats, 1);
    if v_phase = 'done' then
      select coalesce(jsonb_agg(jsonb_build_object('cat', c.cat, 'votes', c.votes, 'winners', c.w) order by c.ord), '[]'::jsonb)
        into v_res
        from (select r.cat, max(r.votes) as votes, array_position(v_cats, r.cat) as ord,
                     jsonb_agg(jsonb_build_object('k', public.olnu_cer_k(p_gid, r.winner),
                       'name', (select gm.display_name from public.group_members gm where gm.group_id = p_gid and gm.user_id = r.winner),
                       'is_me', r.winner = p_uid)) as w
                from public.cer_results r where r.group_id = p_gid and r.night = v_night
               group by r.cat) c;
    end if;
  end if;

  return jsonb_build_object(
    'v', 1, 'group_id', p_gid, 'group_name', (select g.name from public.groups g where g.id = p_gid),
    'night', v_night, 'evening', public.olnu_evening(v_night), 'now', v_now,
    'opens_at', v_open, 'closes_at', v_close, 'phase', v_phase,
    'how', (select d.how from public.cer_done d where d.group_id = p_gid and d.night = v_night),
    'eligible', v_me_out, 'cats', to_jsonb(v_cats), 'voters_n', v_n, 'done_n', v_done_n,
    'my_votes', v_mine, 'my_n', v_my_n, 'my_done', v_my_n >= array_length(v_cats, 1),
    'my_wins', v_wins, 'members', case when p_full then v_members else null end,
    'done_names', case when p_full then v_done_names else null end,
    'results', v_res);
end;
$function$;
