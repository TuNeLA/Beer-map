-- public.olnu_g_tick(p_uid uuid, p_group uuid, p_idx integer, p_on boolean, p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = 3e5382db705a96c30902cf447f03ab2c
CREATE OR REPLACE FUNCTION public.olnu_g_tick(p_uid uuid, p_group uuid, p_idx integer, p_on boolean, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_card  record;
  v_t     record;
  v_ch    int;
  v_arr   int[];
  v_lines int;
  v_new   boolean := false;
  v_on    boolean := coalesce(p_on, true);
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;
  if p_idx is null or p_idx not between 0 and 8 then
    raise exception 'invalid_idx';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_bingo:' || p_group::text, 0));
  select * into v_card from public.game_bingo_cards b where b.group_id = p_group and b.night = v_night;
  if not found then
    raise exception 'no_card';
  end if;
  select * into v_t from public.game_bingo_ticks t where t.group_id = p_group and t.night = v_night and t.idx = p_idx;
  if (v_on and coalesce(v_t.ticked, false)) or (not v_on and not coalesce(v_t.ticked, false)) then
    null;
  else
    if not v_on and v_t.user_id <> p_uid then
      raise exception 'not_yours';
    end if;
    select f.bingo_changes into v_ch from public.game_facts f where f.user_id = p_uid and f.night = v_night;
    if coalesce(v_ch, 0) >= 100 then
      raise exception 'slow_down';
    end if;
    insert into public.game_facts as f (user_id, night, bingo_changes) values (p_uid, v_night, 1)
    on conflict (user_id, night) do update set bingo_changes = f.bingo_changes + 1;
    insert into public.game_bingo_ticks as t (group_id, night, idx, user_id, ticked, updated_at)
    values (p_group, v_night, p_idx, p_uid, v_on, p_now)
    on conflict (group_id, night, idx) do update set user_id = excluded.user_id, ticked = excluded.ticked, updated_at = excluded.updated_at;
  end if;
  select array_agg(t.idx::int order by t.idx) into v_arr from public.game_bingo_ticks t
   where t.group_id = p_group and t.night = v_night and t.ticked;
  v_lines := public.olnu_g_lines(v_arr);
  if v_lines > v_card.lines then
    update public.game_bingo_cards b set lines = v_lines, bingo_at = coalesce(b.bingo_at, p_now)
     where b.group_id = p_group and b.night = v_night;
    v_new := true;
  end if;
  return jsonb_build_object('ok', true, 'ticked', to_jsonb(coalesce(v_arr, '{}'::int[])), 'lines', v_lines, 'new_bingo', v_new);
end;
$function$;
