-- 0384 (bold, owner OK 2026-11-08, flag bold_skal_v2): 📸 SKÅLTIMMEN v2 — "visa var ni är".
-- Extends 0040/0041 (skal_hours, skal_plans, skal_settings, olnu_skal_insert). No live function body is changed.
--   Mode per group: 'off' | 'helg' (Fri + Sat, 21:00–00:30) | 'alla' (every night 20:00–01:00 = the old random_on).
--   Default: groups created after the flag was turned on start on 'helg' (owner decision B); older groups keep random_on.
--   bold_skal_tick(): called by members' phones (bold-skal.js, about once a minute on Fri/Sat evenings). It plans one secret
--   moment per 'helg' group and night, and fires it only when ≥ 2 members are active tonight (live pin, check-in or
--   Ikväll = ute). Otherwise it moves the moment 15 min later (until 00:30), then gives up for the night.
--   The firing phone is fired_by → skal_poll().fired → that phone calls notify-group {event:"skal_hour"} as today.
--   bold_skal_targets(hour_id): for notify-group (service role): who gets the push (active / ute / kanske, not hidden,
--   max one Skåltimme push per person per 90 min across groups) + v2 = true when the flag is on.
-- Additive only.

alter table public.skal_settings add column if not exists mode text;

create table if not exists public.bold_skal_pushed (
  user_id uuid not null,
  hour_id bigint not null,
  at      timestamptz not null default now(),
  primary key (user_id, hour_id)
);
alter table public.bold_skal_pushed enable row level security;
revoke all on table public.bold_skal_pushed from public, anon, authenticated;

create or replace function public.olnu_bold_on(p_key text)
returns boolean language sql stable security definer set search_path to 'public'
as $function$ select coalesce((select f.on_ from public.bold_flags f where f.key = p_key), false); $function$;
revoke all on function public.olnu_bold_on(text) from public, anon, authenticated;

-- The group's mode: the stored one, else 'helg' for groups made after the flag went on, else 'alla'/'off' from random_on.
create or replace function public.olnu_skal_mode(p_group uuid)
returns text language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    (select s.mode from public.skal_settings s where s.group_id = p_group and s.mode in ('off', 'helg', 'alla')),
    case when (select s.random_on from public.skal_settings s where s.group_id = p_group) then 'alla' end,
    case when (select g.created_at from public.groups g where g.id = p_group)
              >= (select f.updated_at from public.bold_flags f where f.key = 'bold_skal_v2' and f.on_) then 'helg' end,
    'off');
$function$;
revoke all on function public.olnu_skal_mode(uuid) from public, anon, authenticated;

-- Members active tonight: a live (not ghost) pin, a live check-in, or Ikväll = ute.
create or replace function public.olnu_skal_active(p_group uuid)
returns table (user_id uuid)
language sql stable security definer set search_path to 'public'
as $function$
  select m.user_id from public.group_members m
   where m.group_id = p_group
     and (exists (select 1 from public.beers b where b.user_id = m.user_id and b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false))
       or exists (select 1 from public.checkins c where c.user_id = m.user_id and c.expires_at > now())
       or exists (select 1 from public.ikvall_status s where s.user_id = m.user_id and s.night = public.olnu_night_of(now()) and s.st = 'ute'));
$function$;
revoke all on function public.olnu_skal_active(uuid) from public, anon, authenticated;

create or replace function public.bold_skal_mode_get(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then raise exception 'not_member'; end if;
  return jsonb_build_object('v', 1, 'on', public.olnu_bold_on('bold_skal_v2'), 'mode', public.olnu_skal_mode(p_group_id),
    'stored', (select s.mode from public.skal_settings s where s.group_id = p_group_id),
    'can_set', public.olnu_skal_can(p_group_id, v_uid));
end; $function$;
revoke all on function public.bold_skal_mode_get(uuid) from public, anon;
grant execute on function public.bold_skal_mode_get(uuid) to authenticated, service_role;

create or replace function public.bold_skal_mode_set(p_group_id uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := public.olnu_uid(); v_mode text := lower(coalesce(p_mode, ''));
begin
  if not public.olnu_bold_on('bold_skal_v2') then raise exception 'feature_off'; end if;
  if v_mode not in ('off', 'helg', 'alla') then raise exception 'invalid_mode'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then raise exception 'not_member'; end if;
  if not public.olnu_skal_can(p_group_id, v_uid) then raise exception 'not_allowed'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_skal_set:' || p_group_id::text, 0));
  if exists (select 1 from public.skal_settings s where s.group_id = p_group_id and s.changed_at > now() - interval '3 seconds') then
    raise exception 'slow_down';
  end if;
  -- 'alla' keeps working through the old skal_poll path (random_on); 'helg' runs through bold_skal_tick.
  insert into public.skal_settings as s (group_id, random_on, changed_by, changed_at, mode)
  values (p_group_id, v_mode = 'alla', v_uid, now(), v_mode)
  on conflict (group_id) do update set random_on = (v_mode = 'alla'), changed_by = v_uid, changed_at = now(), mode = v_mode;
  return jsonb_build_object('v', 1, 'on', true, 'mode', v_mode, 'stored', v_mode, 'can_set', true);
end; $function$;
revoke all on function public.bold_skal_mode_set(uuid, text) from public, anon;
grant execute on function public.bold_skal_mode_set(uuid, text) to authenticated, service_role;

create or replace function public.bold_skal_tick()
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_eve date := public.olnu_evening(public.olnu_night_of(now()));
  v_from timestamptz := ((public.olnu_evening(public.olnu_night_of(now())) + time '21:00') at time zone 'Europe/Stockholm');
  v_to timestamptz := ((public.olnu_evening(public.olnu_night_of(now())) + 1 + time '00:30') at time zone 'Europe/Stockholm');
  g record; p public.skal_plans; h public.skal_hours; v_fired jsonb := '[]'::jsonb; v_n int;
begin
  if not public.olnu_bold_on('bold_skal_v2') then return jsonb_build_object('v', 1, 'off', true); end if;
  if extract(isodow from v_eve) not in (5, 6) or now() < v_from - interval '1 hour' or now() >= v_to then
    return jsonb_build_object('v', 1, 'fired', v_fired, 'window', false);
  end if;
  for g in select m.group_id from public.group_members m where m.user_id = v_uid loop
    continue when public.olnu_skal_mode(g.group_id) <> 'helg';
    select * into p from public.skal_plans x where x.group_id = g.group_id and x.night = v_night;
    if not found then
      insert into public.skal_plans (group_id, night, plan_at)
      values (g.group_id, v_night, greatest(v_from, now() + interval '2 minutes') + random() * greatest(v_to - greatest(v_from, now() + interval '2 minutes') - interval '3 minutes', interval '0 seconds'))
      on conflict (group_id, night) do nothing;
      select * into p from public.skal_plans x where x.group_id = g.group_id and x.night = v_night;
    end if;
    continue when p.hour_id is not null or now() < p.plan_at;
    perform pg_advisory_xact_lock(hashtextextended('olnu_skal:' || g.group_id::text, 0));
    select * into p from public.skal_plans x where x.group_id = g.group_id and x.night = v_night;
    continue when p.hour_id is not null;
    select count(*) into v_n from public.olnu_skal_active(g.group_id);
    if v_n < 2 then
      if p.plan_at + interval '15 minutes' < v_to then
        update public.skal_plans x set plan_at = p.plan_at + interval '15 minutes' where x.group_id = g.group_id and x.night = v_night;
      else
        update public.skal_plans x set hour_id = 0 where x.group_id = g.group_id and x.night = v_night;
      end if;
      continue;
    end if;
    h := public.olnu_skal_insert(g.group_id, null, v_uid, true);
    if h.id is not null then
      update public.skal_plans x set hour_id = h.id where x.group_id = g.group_id and x.night = v_night;
      v_fired := v_fired || to_jsonb(h.id);
    elsif p.plan_at + interval '31 minutes' < v_to then
      update public.skal_plans x set plan_at = now() + interval '31 minutes' where x.group_id = g.group_id and x.night = v_night;
    else
      update public.skal_plans x set hour_id = 0 where x.group_id = g.group_id and x.night = v_night;
    end if;
  end loop;
  return jsonb_build_object('v', 1, 'fired', v_fired, 'window', true);
end; $function$;
revoke all on function public.bold_skal_tick() from public, anon;
grant execute on function public.bold_skal_tick() to authenticated, service_role;

-- For notify-group (service role only): v2 copy + who gets the push. Records the push (90-min cap across groups).
create or replace function public.bold_skal_targets(p_hour_id bigint)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare h public.skal_hours; v_ids uuid[];
begin
  select * into h from public.skal_hours x where x.id = p_hour_id;
  if not found then return jsonb_build_object('v', 1, 'v2', false, 'user_ids', '[]'::jsonb); end if;
  if not public.olnu_bold_on('bold_skal_v2') then return jsonb_build_object('v', 1, 'v2', false, 'user_ids', null); end if;
  select coalesce(array_agg(m.user_id), '{}') into v_ids
    from public.group_members m
   where m.group_id = h.group_id and m.user_id is distinct from h.started_by
     and (m.user_id in (select a.user_id from public.olnu_skal_active(h.group_id) a)
          or exists (select 1 from public.ikvall_status s where s.user_id = m.user_id and s.night = public.olnu_night_of(now()) and s.st in ('ute', 'kanske')))
     and not exists (select 1 from public.bold_skal_pushed q where q.user_id = m.user_id and q.hour_id <> p_hour_id and q.at > now() - interval '90 minutes');
  insert into public.bold_skal_pushed (user_id, hour_id) select unnest(v_ids), p_hour_id on conflict do nothing;
  return jsonb_build_object('v', 1, 'v2', true, 'group_id', h.group_id, 'user_ids', to_jsonb(v_ids));
end; $function$;
revoke all on function public.bold_skal_targets(bigint) from public, anon, authenticated;
grant execute on function public.bold_skal_targets(bigint) to service_role;
