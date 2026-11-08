-- public.olnu_g_me(p_uid uuid, p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = c257de4843e5566af1ff754f70b16a1a
CREATE OR REPLACE FUNCTION public.olnu_g_me(p_uid uuid, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_prev  timestamptz := public.olnu_g_prev(public.olnu_night_of(p_now));
  v_close timestamptz := (public.olnu_evening(public.olnu_night_of(p_now))::timestamp + interval '21 hours') at time zone 'Europe/Stockholm';
  r record;
  v_p int;
  v_m jsonb := '[]'::jsonb;
  v_done int := 0;
  v_fresh boolean;
  v_guess jsonb := null;
  v_gprev jsonb := null;
  v_g record;
  v_real int;
  v_f record;
  v_sugen text;
  v_agents jsonb;
  v_tlat float8; v_tlng float8;
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  perform public.olnu_g_assign(p_uid, v_night, p_now);
  for r in select * from public.game_missions gm where gm.user_id = p_uid and gm.night = v_night order by gm.slot loop
    v_fresh := false;
    if r.done_at is null then
      v_p := least(r.goal, public.olnu_g_progress(p_uid, v_night, r.kind, p_now));
      if v_p >= r.goal then
        update public.game_missions gm set progress = v_p, done_at = p_now
         where gm.user_id = p_uid and gm.night = v_night and gm.slot = r.slot and gm.done_at is null;
        v_fresh := true;
        r.done_at := p_now;
      elsif v_p <> r.progress then
        update public.game_missions gm set progress = v_p
         where gm.user_id = p_uid and gm.night = v_night and gm.slot = r.slot;
      end if;
    else
      v_p := r.goal;
    end if;
    if r.done_at is not null then v_done := v_done + 1; end if;
    v_m := v_m || jsonb_build_object('slot', r.slot, 'id', r.mission, 'kind', r.kind, 'goal', r.goal,
      'progress', v_p, 'done', r.done_at is not null, 'fresh', v_fresh, 'done_at', r.done_at);
  end loop;

  select * into v_g from public.game_guesses g where g.user_id = p_uid and g.night = v_night;
  if found then
    v_guess := jsonb_build_object('guess', v_g.guess, 'town', v_g.town);
    v_tlat := v_g.lat; v_tlng := v_g.lng;
  end if;
  select * into v_g from public.game_guesses g where g.user_id = p_uid and g.night = v_prev;
  if found then
    v_real := v_g.real;
    if v_real is null then
      v_real := public.olnu_g_real(v_prev, v_g.lat, v_g.lng);
      update public.game_guesses g set real = v_real where g.user_id = p_uid and g.night = v_prev and g.real is null;
    end if;
    v_gprev := jsonb_build_object('guess', v_g.guess, 'town', v_g.town, 'real', v_real);
  end if;

  select f.water, f.home_at into v_f from public.game_facts f where f.user_id = p_uid and f.night = v_night;
  select s.status into v_sugen from public.game_sugen s where s.user_id = p_uid and s.night = v_night;

  select coalesce(jsonb_agg(jsonb_build_object('group_id', a.group_id, 'group_name', g.name, 'mission', a.mission)), '[]'::jsonb)
    into v_agents
    from public.game_agents a join public.groups g on g.id = a.group_id
   where a.agent = p_uid and a.night = v_night
     and exists (select 1 from public.group_members m where m.group_id = a.group_id and m.user_id = p_uid);

  return jsonb_build_object(
    'night', v_night, 'missions', v_m, 'done_n', v_done,
    'water', coalesce(v_f.water, 0), 'home_at', v_f.home_at,
    'guess', v_guess, 'guess_open', p_now < v_close, 'guess_closes', v_close,
    'guess_so_far', case when p_now >= v_close and v_guess is not null
                         then public.olnu_g_real(v_night, v_tlat, v_tlng) end,
    'guess_prev', v_gprev,
    'sugen', case when v_sugen = 'none' then null else v_sugen end,
    'out', public.olnu_g_outtonight(p_uid, v_night),
    'agent', v_agents);
end;
$function$;
