-- 0195 📸 FILMSTART (owner 2026-11-07; additive, notify-group v27 event "film_start"). Needs 0042 (snap_photos,
-- film_rolls, film_poll), 0093 and 0190 (push kinds).
-- "Gänget fotar ikväll": the first film shot of a night in a group writes ONE film_starts row (trigger, never fails
-- the shot). The starter's app then calls notify-group {event:"film_start", group_id}; the edge function claims the
-- row (started_by = caller, notified = false, < 30 min old) → one push per group per night.
-- film_poll gets 4 more fields per group (group_name, shooters, first_name, first_at) for the 📸 HUD chip.
-- Push kind "film" (📸 Engångskameran: filmstart + framkallad) joins olnu_push_cats (was part of "kul").
-- No row is ever removed.

create table if not exists public.film_starts (
  group_id uuid not null,
  night timestamptz not null,
  started_by uuid not null,
  created_at timestamptz not null default now(),
  notified boolean not null default false,
  primary key (group_id, night)
);
alter table public.film_starts enable row level security;
revoke all on table public.film_starts from public, anon, authenticated;

create or replace function public.olnu_film_start_trg()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.kind = 'film' and new.group_id is not null and new.night is not null and new.user_id is not null then
    begin
      insert into public.film_starts (group_id, night, started_by) values (new.group_id, new.night, new.user_id)
      on conflict (group_id, night) do nothing;
    exception when others then null;   -- the shot must never fail because of this
    end;
  end if;
  return null;
end $$;
revoke all on function public.olnu_film_start_trg() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'snap_photos_film_start' and tgrelid = 'public.snap_photos'::regclass) then
    create trigger snap_photos_film_start after insert on public.snap_photos
      for each row execute function public.olnu_film_start_trg();
  end if;
end $$;

-- Push kinds: + film
create or replace function public.olnu_push_cats()
returns text[] language sql immutable set search_path to 'public' as $$
  select array['ute','chat','dm','plan','kaos','bar','kul','vanner','film']::text[]
$$;

-- film_poll: same as 0042/0093 + per group: group_name, shooters, first_name (starter's name in that group), first_at.
create or replace function public.film_poll()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  r       record;
  v_rolls jsonb := '[]'::jsonb;
  v_mine  boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  for r in select sp.group_id, sp.night, min(sp.reveal_at) as rev, count(*)::int as n
             from public.snap_photos sp
             join public.group_members m on m.group_id = sp.group_id and m.user_id = v_uid
            where sp.kind = 'film' and sp.reveal_at <= now() and sp.reveal_at > now() - interval '20 hours'
            group by sp.group_id, sp.night loop
    v_mine := false;
    insert into public.film_rolls (group_id, night, claimed_by, claimed_at)
    values (r.group_id, r.night, v_uid, now())
    on conflict (group_id, night) do nothing;
    if found then v_mine := true; end if;
    if not v_mine then
      v_mine := exists (select 1 from public.film_rolls f where f.group_id = r.group_id and f.night = r.night
                         and f.claimed_by = v_uid and not f.notified and f.claimed_at > now() - interval '10 minutes');
    end if;
    v_rolls := v_rolls || jsonb_build_array(jsonb_build_object('group_id', r.group_id,
      'group_name', (select g.name from public.groups g where g.id = r.group_id),
      'night', r.night, 'develop_at', r.rev, 'n', r.n, 'push_mine', v_mine));
  end loop;
  return jsonb_build_object('v', 2, 'now', now(), 'night', v_night, 'develop_at', public.olnu_gang_reveal(v_night),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('group_id', m.group_id,
        'mine', (select count(*) from public.snap_photos sp where sp.group_id = m.group_id and sp.kind = 'film' and sp.night = v_night and sp.user_id = v_uid)::int,
        'left', greatest(0, 10 - (select count(*) from public.snap_photos sp where sp.group_id = m.group_id and sp.kind = 'film' and sp.night = v_night and sp.user_id = v_uid))::int,
        'group_n', (select count(*) from public.snap_photos sp where sp.group_id = m.group_id and sp.kind = 'film' and sp.night = v_night)::int,
        'group_name', (select g.name from public.groups g where g.id = m.group_id),
        'shooters', (select count(distinct sp.user_id) from public.snap_photos sp where sp.group_id = m.group_id and sp.kind = 'film' and sp.night = v_night)::int,
        'first_name', (select gm.display_name from public.film_starts fs join public.group_members gm on gm.group_id = fs.group_id and gm.user_id = fs.started_by
                        where fs.group_id = m.group_id and fs.night = v_night),
        'first_me', coalesce((select fs.started_by = v_uid from public.film_starts fs where fs.group_id = m.group_id and fs.night = v_night), false),
        'first_at', (select fs.created_at from public.film_starts fs where fs.group_id = m.group_id and fs.night = v_night)))
        from public.group_members m where m.user_id = v_uid), '[]'::jsonb),
    'rolls', v_rolls);
end; $function$;
