-- 0210 LAGRINGSTID · old raw positions are removed after 30 days (store-compliance A6, GDPR art. 5(1)(e)).
-- Why 30 days:
--   * Everything the app shows from raw positions is shorter: pins end at 05:00, "Senaste dagarna" ghost layer
--     ≈ 10 days, week boards 7 days, "Mina kvällar" / Min kväll the last 30 days.
--   * 30 days leaves time to handle a report or a "where was my friend" question, and is still short (EDPB:
--     keep location only as long as needed).
--   * Stats and medals do not need raw positions: board_nights (≈ 5 km), medal_nights.cell and towns stay.
-- How: UPDATE only (no row is removed). Nullable columns → null. NOT NULL columns → snapped to a ≈ 5 km grid
--   (0.05° lat, 0.1° lng), the same grid as board_nights. Place coordinates that are not a person's position
--   (kebab_ratings, place_suggestions = the place itself) are kept.
-- Live rule: the job runs every night but does nothing while app_store_flags.retention = 'off' (set 'on' on release day):
--   update public.app_store_flags set value = 'on', updated_at = now() where key = 'retention';
-- Manual run (owner): select public.olnu_retention_run(true);
-- No row-removing or object-removing statement in this file.

create extension if not exists pg_cron;

create or replace function public.olnu_retention_run(p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cut timestamptz := now() - interval '30 days';
  v jsonb := '{}'::jsonb;
  n int;
begin
  if not coalesce(p_force, false)
     and coalesce((select f.value from public.app_store_flags f where f.key = 'retention'), 'off') <> 'on' then
    return jsonb_build_object('ok', true, 'skipped', 'retention flag off');
  end if;

  update public.drink_log x set lat = null, lng = null where x.at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('drink_log', n);
  update public.crew_tracks x set lat = round(x.lat::numeric / 0.05) * 0.05, lng = round(x.lng::numeric / 0.1) * 0.1
   where x.at < v_cut and (x.lat <> round(x.lat::numeric / 0.05) * 0.05 or x.lng <> round(x.lng::numeric / 0.1) * 0.1);
  get diagnostics n = row_count; v := v || jsonb_build_object('crew_tracks', n);
  update public.checkins x set lat = round(x.lat::numeric / 0.05) * 0.05, lng = round(x.lng::numeric / 0.1) * 0.1
   where x.created_at < v_cut and (x.lat <> round(x.lat::numeric / 0.05) * 0.05 or x.lng <> round(x.lng::numeric / 0.1) * 0.1);
  get diagnostics n = row_count; v := v || jsonb_build_object('checkins', n);
  update public.game_guesses x set lat = round(x.lat::numeric / 0.05) * 0.05, lng = round(x.lng::numeric / 0.1) * 0.1
   where x.created_at < v_cut and (x.lat <> round(x.lat::numeric / 0.05) * 0.05 or x.lng <> round(x.lng::numeric / 0.1) * 0.1);
  get diagnostics n = row_count; v := v || jsonb_build_object('game_guesses', n);
  -- beers: one row per user; an old (expired) row keeps no exact position
  update public.beers x set lat = round(x.lat::numeric / 0.05) * 0.05, lng = round(x.lng::numeric / 0.1) * 0.1,
         prev_lat = null, prev_lng = null, snap_lat = null, snap_lng = null, precise = false
   where x.expires_at < v_cut and (x.lat <> round(x.lat::numeric / 0.05) * 0.05 or x.lng <> round(x.lng::numeric / 0.1) * 0.1
                                   or x.prev_lat is not null or x.snap_lat is not null);
  get diagnostics n = row_count; v := v || jsonb_build_object('beers', n);
  update public.bar_reports x set user_lat = null, user_lng = null where x.created_at < v_cut and x.user_lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('bar_reports', n);
  update public.beer_types x set lat = null, lng = null where x.created_at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('beer_types', n);
  update public.bar_taps x set lat = null, lng = null where x.last_at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('bar_taps', n);
  update public.crew_deps x set lat = null, lng = null where x.created_at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('crew_deps', n);
  update public.etas x set lat = null, lng = null where x.created_at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('etas', n);
  update public.rallies x set lat = null, lng = null where x.created_at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('rallies', n);
  update public.gang_brunches x set lat = null, lng = null where x.created_at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('gang_brunches', n);
  update public.find_pos x set lat = null, lng = null where x.updated_at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('find_pos', n);
  update public.walks x set lat = null, lng = null, home_lat = null, home_lng = null
   where x.started_at < v_cut and (x.lat is not null or x.home_lat is not null);
  get diagnostics n = row_count; v := v || jsonb_build_object('walks', n);
  update public.push_subscriptions x set lat = null, lng = null where coalesce(x.loc_at, x.created_at) < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('push_subscriptions', n);
  -- device model / browser in client_vitals are not location, but they are linked to a user: 30 days too
  update public.client_vitals x set model = null, browser = null, detail = null where x.created_at < v_cut and (x.model is not null or x.detail is not null);
  get diagnostics n = row_count; v := v || jsonb_build_object('client_vitals', n);

  return jsonb_build_object('ok', true, 'cut', v_cut, 'rows', v);
end; $$;
revoke all on function public.olnu_retention_run(boolean) from public, anon, authenticated;

-- Every night 03:17 UTC (04:17 or 05:17 in Sweden: low traffic).
select cron.schedule('olnu-retention', '17 3 * * *', $c$select public.olnu_retention_run(false)$c$)
 where not exists (select 1 from cron.job j where j.jobname = 'olnu-retention');
