-- public.push_pace_take(p_uids uuid[], p_lines text[], p_grps text[], p_gaps integer[], p_maxes integer[])
-- live md5(pg_get_functiondef) = 2701d6eef3419b6a191a9dc16aa19477
CREATE OR REPLACE FUNCTION public.push_pace_take(p_uids uuid[], p_lines text[], p_grps text[], p_gaps integer[], p_maxes integer[])
 RETURNS TABLE(uid uuid, verdict text, held_n integer, held_lines text[], held_grp text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_night timestamptz := public.olnu_night_of(now());
  i int; r public.push_pace%rowtype; v_u uuid; v_gap int; v_max int; v_line text; v_l text[];
begin
  for i in 1 .. least(coalesce(array_length(p_uids, 1), 0), 2000) loop
    v_u := p_uids[i];
    if v_u is null then continue; end if;
    v_gap := greatest(0, least(3600, coalesce(p_gaps[i], 600)));
    v_max := greatest(1, least(99, coalesce(p_maxes[i], 8)));
    v_line := left(coalesce(p_lines[i], ''), 90);
    insert into public.push_pace (user_id, night) values (v_u, v_night) on conflict (user_id) do nothing;
    select * into r from public.push_pace where user_id = v_u for update;
    if r.night is distinct from v_night then
      r.night := v_night; r.n := 0; r.last_at := null; r.held := 0; r.lines := '{}'; r.grp := null; r.over_cap := 0;
    end if;
    if r.n >= v_max then
      update public.push_pace set night = r.night, n = r.n, last_at = r.last_at, held = 0, lines = '{}', grp = null,
        over_cap = r.over_cap + 1, updated_at = now() where user_id = v_u;
      uid := v_u; verdict := 'cap'; held_n := 0; held_lines := '{}'; held_grp := null; return next;
    elsif r.last_at is not null and r.last_at > now() - make_interval(secs => v_gap) then
      v_l := r.lines || v_line;
      if cardinality(v_l) > 4 then v_l := v_l[cardinality(v_l) - 3 : cardinality(v_l)]; end if;
      update public.push_pace set night = r.night, n = r.n, last_at = r.last_at, held = r.held + 1, lines = v_l,
        grp = coalesce(nullif(left(coalesce(p_grps[i], ''), 60), ''), r.grp), over_cap = r.over_cap, updated_at = now()
        where user_id = v_u;
      uid := v_u; verdict := 'hold'; held_n := r.held + 1; held_lines := v_l; held_grp := null; return next;
    else
      uid := v_u; verdict := case when r.held > 0 then 'digest' else 'send' end;
      held_n := r.held; held_lines := r.lines; held_grp := r.grp;
      update public.push_pace set night = r.night, n = r.n + 1, last_at = now(), held = 0, lines = '{}', grp = null,
        over_cap = r.over_cap, updated_at = now() where user_id = v_u;
      return next;
    end if;
  end loop;
end $function$;
