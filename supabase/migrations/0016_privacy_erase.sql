-- Öl Nu v14: privacy (server part of the v14 client). Additive. Safe to run again.
-- Binding spec: CONTRACT.md, section "v14 CLIENT".
--  1. olnu_near_bar(): restaurants, cafés and fast food places (bars_lite.type restaurant | fast_food | cafe,
--     ids "pl_<lat*1e5>_<lng*1e5>") are snap points too, within 40 m (bars: 75 m); a bar always wins.
--  2. delete_my_data(): "Radera allt om mig". Rows are never removed (this file has no remove-type
--     statements on purpose). Instead every row of the caller is anonymized: it is moved to a new random
--     user id that no login can ever have, positions are set to 0/0 or null, texts are blanked, and live
--     things end now. The caller leaves all groups and the push subscriptions go (existing RPC logic).
--     Afterwards the auth user owns nothing. The client then signs out and clears the phone.
-- Needs 0001-0015 first. Postgres 14+.

-- ---------------------------------------------------------------------------
-- 1. Nearest snap point: bars (75 m) first, then restaurants / cafés / fast food (40 m)
-- ---------------------------------------------------------------------------
create or replace function public.olnu_near_bar(p_lat float8, p_lng float8)
returns table (id text, lat float8, lng float8)
language sql
stable
set search_path = public
as $$
  select bl.id, bl.lat, bl.lng
    from public.bars_lite bl
   where bl.active
     and bl.lat between p_lat - 0.0007 and p_lat + 0.0007
     and bl.lng between p_lng - 0.0019 and p_lng + 0.0019
     and power((bl.lat - p_lat) * 111195, 2) + power((bl.lng - p_lng) * 111195 * cos(radians(p_lat)), 2)
         <= case when coalesce(bl.type, '') in ('restaurant', 'fast_food', 'cafe') then 1600 else 5625 end
   order by (coalesce(bl.type, '') in ('restaurant', 'fast_food', 'cafe')),
            power((bl.lat - p_lat) * 111195, 2) + power((bl.lng - p_lng) * 111195 * cos(radians(p_lat)), 2), bl.id
   limit 1;
$$;

revoke all on function public.olnu_near_bar(float8, float8) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_near_bar(float8, float8) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_near_bar(float8, float8) from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. delete_my_data() -> jsonb {ok, groups_left, subscriptions, moved_rows}
-- ---------------------------------------------------------------------------
-- Every row of the caller goes to v_new (a fresh random uuid that is not an auth user), so nothing
-- links it to the person any more. Group-wide counts (a skål on a friend's pin, a beer in tonight's
-- totals) stay as anonymous numbers. Earned medals and night facts are no longer anyone's.
create or replace function public.delete_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_new  uuid := gen_random_uuid();
  v_g    uuid;
  v_ep   text;
  v_ng   int := 0;
  v_ns   int := 0;
  v_rows int := 0;
  v_n    int;
  v_tab  text;
  v_col  text;
begin
  -- Groups: leave every group (the old leave_group logic; an empty group goes away with it).
  for v_g in select gm.group_id from public.group_members gm where gm.user_id = v_uid loop
    perform public.leave_group(v_g);
    v_ng := v_ng + 1;
  end loop;
  update public.groups g set created_by = null where g.created_by = v_uid;

  -- Push: the old delete_push_subscription logic for each endpoint.
  for v_ep in select ps.endpoint from public.push_subscriptions ps where ps.user_id = v_uid loop
    perform public.delete_push_subscription(v_ep);
    v_ns := v_ns + 1;
  end loop;

  -- Stats and medal facts first: the medal triggers on beers / checkins / bar_taps (fired by the
  -- updates below) then find these rows already moved and add nothing that could clash.
  update public.week_beers w set user_id = v_new where w.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.bar_taps t set user_id = v_new, lat = null, lng = null where t.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  update public.user_medals um set user_id = v_new where um.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.medal_nights mn set user_id = v_new, cell = null where mn.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.medal_checkins mc set user_id = v_new where mc.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.medal_counts mo set user_id = v_new where mo.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.medal_claims ml set user_id = v_new where ml.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.push_sent p set user_id = v_new where p.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  -- Pin: hidden now, no position, no undo state.
  update public.beers b
     set user_id = v_new, lat = 0, lng = 0, precise = false, stopped = true, ghost = false,
         expires_at = least(b.expires_at, now()),
         prev_lat = null, prev_lng = null, prev_precise = null, prev_stopped = null, prev_ghost = null,
         prev_beer_at = null, prev_for = null
   where b.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  update public.checkins c
     set user_id = v_new, lat = 0, lng = 0, expires_at = least(c.expires_at, now())
   where c.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  update public.group_msgs m
     set user_id = v_new, body = '🗑️', expires_at = least(m.expires_at, now())
   where m.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  update public.rallies r
     set user_id = v_new, body = '🗑️', place = null, lat = null, lng = null, closed = true,
         expires_at = least(r.expires_at, now())
   where r.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  update public.rally_answers a set user_id = v_new where a.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.skals s set user_id = v_new where s.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  update public.reactions x set user_id = v_new, active = false where x.user_id = v_uid;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  -- v12 tables (0014 is optional): only when they exist.
  if to_regclass('public.bar_queue') is not null then
    execute 'update public.bar_queue q set user_id = $1, expires_at = least(q.expires_at, now()) where q.user_id = $2' using v_new, v_uid;
    get diagnostics v_n = row_count; v_rows := v_rows + v_n;
    execute 'update public.bar_offers o set user_id = $1, expires_at = least(o.expires_at, now()) where o.user_id = $2' using v_new, v_uid;
    get diagnostics v_n = row_count; v_rows := v_rows + v_n;
    execute 'update public.bar_offer_votes v set user_id = $1 where v.user_id = $2' using v_new, v_uid;
    get diagnostics v_n = row_count; v_rows := v_rows + v_n;
    execute 'update public.bar_tips tp set user_id = $1, body = null where tp.user_id = $2' using v_new, v_uid;
    get diagnostics v_n = row_count; v_rows := v_rows + v_n;
    execute 'update public.beer_types bt set user_id = $1, lat = null, lng = null where bt.user_id = $2' using v_new, v_uid;
    get diagnostics v_n = row_count; v_rows := v_rows + v_n;
    execute 'update public.group_flags f set updated_by = null where f.updated_by = $1' using v_uid;
  end if;

  -- Newer tables (games, voice, chat likes, …): blank what is personal, then move every uuid column that
  -- points at the caller to v_new. Generic, so tables added later are covered too. Each statement runs in
  -- its own block: one odd table can never stop the rest.
  begin
    if to_regclass('public.voice_msgs') is not null then
      execute 'update public.voice_msgs v set audio = ''\x''::bytea, dur_ms = 0, expires_at = least(v.expires_at, now()) where v.user_id = $1' using v_uid;
    end if;
  exception when others then null;
  end;
  begin
    if to_regclass('public.game_guesses') is not null then
      execute 'update public.game_guesses g set lat = null, lng = null, town = null where g.user_id = $1' using v_uid;
    end if;
  exception when others then null;
  end;
  begin
    if to_regclass('public.after_nights') is not null then
      execute 'update public.after_nights a set town = null where a.user_id = $1' using v_uid;
    end if;
  exception when others then null;
  end;
  for v_tab, v_col in
    select c.table_name::text, c.column_name::text
      from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public' and tb.table_type = 'BASE TABLE' and c.data_type = 'uuid'
       and c.column_name not in ('id', 'group_id')
       and c.table_name not in ('groups', 'group_members', 'group_flags', 'push_subscriptions')
  loop
    begin
      execute format('update public.%I set %I = $1 where %I = $2', v_tab, v_col, v_col) using v_new, v_uid;
      get diagnostics v_n = row_count; v_rows := v_rows + v_n;
    exception when others then null;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'groups_left', v_ng, 'subscriptions', v_ns, 'moved_rows', v_rows);
end;
$$;

revoke all on function public.delete_my_data() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.delete_my_data() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.delete_my_data() to authenticated';
  end if;
end $$;

-- 3. Re-snap tonight's pins and heat rows (restaurants may have been added to bars_lite).
select public.olnu_resnap();
