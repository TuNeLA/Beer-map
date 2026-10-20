-- 0040 v27 SKÅLTIMMEN + ENGÅNGSKAMERAN: tables and helpers. Client: docs/js/skal.js, docs/js/film.js, docs/skal.css.
-- SKÅLTIMMEN (BeReal style): the chief, the owner or a vice starts it (or the server, "slumpad skåltimme", once per
--   night at a random moment 20:00-01:00 Europe/Stockholm). Every member has 3 min to post a photo of the drink.
--   You see the others' photos only after you post your own. Limits per group: 1 per 30 min, 4 per night.
-- ENGÅNGSKAMERAN: 10 shots per member per group per night. Nobody sees a shot (not even the one who took it) until
--   10:00 the next morning (olnu_gang_reveal). Then the roll is "framkallad" and the group can react to the photos.
-- Photo bytes: same pipeline and byte limits as 0028 (JPEG/WebP, 200 B - 160 KB, w/h 1-2048). They are stored in
--   snap_photos, NOT in chat_photos: group_photo / group_photos / night_story_photo hand out any chat photo to any
--   member, and that would break both "post to see" and "hidden until 10:00". The meriter (0036) and duel (0031)
--   triggers on chat_photos would also count these shots as chat photos.
-- Space: every write first sets bytes = null on expired snap photos (an UPDATE; rows stay, autovacuum reuses space).
--   skål photos live until 12:00 the day the night ends; film photos 7 days after 10:00 (30 days when the group keeps
--   its chat, 0029). Rows are never removed. RLS on, no policies, no client access.
-- Needs 0001-0034 (group_members, groups, olnu_uid, olnu_night_of, olnu_evening, olnu_gang_reveal, olnu_gang_k,
--   olnu_gang_name, olnu_group_keeps, olnu_chief_of, olnu_owner_of, olnu_is_vice). Safe to run again.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.snap_photos (
  id         bigserial primary key,
  kind       text not null check (kind in ('skal', 'film')),
  group_id   uuid not null,
  user_id    uuid not null,
  ref_id     bigint null,                        -- skal: skal_hours.id; film: null
  night      timestamptz not null,               -- olnu_night_of(created_at) (the 05:00 end)
  mime       text not null,
  bytes      bytea null,
  size       int not null default 0,
  w          int not null default 0,
  h          int not null default 0,
  created_at timestamptz not null default now(),
  reveal_at  timestamptz null,                   -- film: 10:00 the morning the night ends
  expires_at timestamptz not null
);
create index if not exists snap_photos_gkn_idx  on public.snap_photos (group_id, kind, night, user_id);
create index if not exists snap_photos_user_idx on public.snap_photos (user_id, created_at);
create index if not exists snap_photos_ref_idx  on public.snap_photos (ref_id) where ref_id is not null;
create index if not exists snap_photos_live_idx on public.snap_photos (expires_at) where bytes is not null;

create table if not exists public.skal_hours (
  id         bigserial primary key,
  group_id   uuid not null,
  started_by uuid null,                          -- null = "slumpad skåltimme" (the server)
  fired_by   uuid not null,                      -- the caller whose RPC created the row (push claim)
  auto       boolean not null default false,
  night      timestamptz not null,
  created_at timestamptz not null default now(),
  ends_at    timestamptz not null,               -- created_at + 3 min
  notified   boolean not null default false      -- push claim (edge function)
);
create index if not exists skal_hours_group_idx on public.skal_hours (group_id, created_at desc);

-- One row per member and skåltimme. THE EVENT for meriter: in_time = posted within the 3 min, pts = 5 when in time.
create table if not exists public.skal_hour_posts (
  hour_id    bigint not null,
  user_id    uuid not null,
  group_id   uuid not null,
  night      timestamptz not null,
  photo_id   bigint null,
  created_at timestamptz not null default now(),
  sec        int not null default 0,             -- seconds after the start
  in_time    boolean not null,
  rank       int not null,                       -- 1 = first in
  pts        int not null default 0,             -- meriter worth (5 in time, else 0); meriter decides
  primary key (hour_id, user_id)
);
create index if not exists skal_hour_posts_user_idx  on public.skal_hour_posts (user_id, night);
create index if not exists skal_hour_posts_group_idx on public.skal_hour_posts (group_id, night);

create table if not exists public.skal_settings (
  group_id   uuid primary key,
  random_on  boolean not null default false,
  changed_by uuid null,
  changed_at timestamptz not null default now()
);

-- The secret random moment of a night for a group with random_on (made by the first poll of that night).
create table if not exists public.skal_plans (
  group_id   uuid not null,
  night      timestamptz not null,
  plan_at    timestamptz not null,
  hour_id    bigint null,                        -- the fired skåltimme; 0 = skipped (limit / too late)
  created_at timestamptz not null default now(),
  primary key (group_id, night)
);

create table if not exists public.film_reacts (
  photo_id   bigint not null,
  user_id    uuid not null,
  emoji      text not null,
  active     boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (photo_id, user_id)
);
create index if not exists film_reacts_user_idx on public.film_reacts (user_id, updated_at);

-- "Filmen är framkallad!" push claim: the first member whose poll sees the developed roll claims it.
create table if not exists public.film_rolls (
  group_id   uuid not null,
  night      timestamptz not null,
  claimed_by uuid not null,
  claimed_at timestamptz not null default now(),
  notified   boolean not null default false,
  primary key (group_id, night)
);

alter table public.snap_photos     enable row level security;
alter table public.skal_hours      enable row level security;
alter table public.skal_hour_posts enable row level security;
alter table public.skal_settings   enable row level security;
alter table public.skal_plans      enable row level security;
alter table public.film_reacts     enable row level security;
alter table public.film_rolls      enable row level security;

do $$
declare
  v_t text := 'public.snap_photos, public.skal_hours, public.skal_hour_posts, public.skal_settings, public.skal_plans, '
           || 'public.film_reacts, public.film_rolls';
  v_s text := 'public.snap_photos_id_seq, public.skal_hours_id_seq';
begin
  execute 'revoke all on table ' || v_t || ' from public';
  execute 'revoke all on sequence ' || v_s || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table ' || v_t || ' from anon';
    execute 'revoke all on sequence ' || v_s || ' from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table ' || v_t || ' from authenticated';
    execute 'revoke all on sequence ' || v_s || ' from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table ' || v_t || ' to service_role';
    execute 'grant all on sequence ' || v_s || ' to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers (internal, no grants)
-- ---------------------------------------------------------------------------

-- Base64 photo -> (bytes, mime). Same rules as post_photo (0028). Raises invalid_photo.
create or replace function public.olnu_snap_decode(p_b64 text, p_w int, p_h int, out o_bytes bytea, out o_mime text)
language plpgsql immutable security definer set search_path = public as $$
begin
  if p_b64 is null or length(p_b64) > 220000 then raise exception 'invalid_photo'; end if;
  begin
    o_bytes := decode(regexp_replace(p_b64, '\s', '', 'g'), 'base64');
  exception when others then
    raise exception 'invalid_photo';
  end;
  if o_bytes is null or octet_length(o_bytes) < 200 or octet_length(o_bytes) > 163840 then raise exception 'invalid_photo'; end if;
  if substring(o_bytes from 1 for 3) = '\xffd8ff'::bytea then
    o_mime := 'image/jpeg';
  elsif substring(o_bytes from 1 for 4) = '\x52494646'::bytea and substring(o_bytes from 9 for 4) = '\x57454250'::bytea then
    o_mime := 'image/webp';
  else
    raise exception 'invalid_photo';
  end if;
  if coalesce(p_w, 0) < 1 or coalesce(p_h, 0) < 1 or p_w > 2048 or p_h > 2048 then raise exception 'invalid_photo'; end if;
end; $$;

-- Expiry of a snap photo. skal: 12:00 the day the night ends; film: 7 days after the 10:00 reveal.
-- A group that keeps its chat (0029) keeps them 30 days (skal: 30 days after the 12:00).
create or replace function public.olnu_snap_exp(p_kind text, p_group uuid, p_night timestamptz, p_reveal timestamptz)
returns timestamptz language sql stable security definer set search_path = public as $$
  select case when p_kind = 'film'
              then coalesce(p_reveal, public.olnu_gang_reveal(p_night))
                   + case when public.olnu_group_keeps(p_group) then interval '30 days' else interval '7 days' end
              else (((p_night at time zone 'Europe/Stockholm')::date + time '12:00') at time zone 'Europe/Stockholm')
                   + case when public.olnu_group_keeps(p_group) then interval '30 days' else interval '0 days' end
         end;
$$;

-- Empty the bytes of expired snap photos (rows stay; the space is reused).
create or replace function public.olnu_snap_sweep()
returns void language sql security definer set search_path = public as $$
  update public.snap_photos sp set bytes = null where sp.expires_at < now() and sp.bytes is not null;
$$;

-- Who may start a skåltimme / switch the random mode: the gruppchef, the owner or a vice.
create or replace function public.olnu_skal_can(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null
     and exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid)
     and (public.olnu_chief_of(p_group) = p_uid
          or public.olnu_owner_of(p_group) is not distinct from p_uid
          or public.olnu_is_vice(p_group, p_uid));
$$;

-- Start of tonight (the 05:00 before the next 05:00), DST-correct.
create or replace function public.olnu_skal_from()
returns timestamptz language sql stable security definer set search_path = public as $$
  select ((public.olnu_night_of(now()) at time zone 'Europe/Stockholm') - interval '1 day') at time zone 'Europe/Stockholm';
$$;

-- Random window of a night: 20:00 on the evening .. 01:00 the next day (Europe/Stockholm).
create or replace function public.olnu_skal_win_from(p_night timestamptz)
returns timestamptz language sql stable security definer set search_path = public as $$
  select ((public.olnu_evening(p_night) + time '20:00') at time zone 'Europe/Stockholm');
$$;
create or replace function public.olnu_skal_win_to(p_night timestamptz)
returns timestamptz language sql stable security definer set search_path = public as $$
  select (((public.olnu_evening(p_night) + 1) + time '01:00') at time zone 'Europe/Stockholm');
$$;

-- "Radera allt om mig" (0016 sweep moves user_id): empty the picture, end it now.
create or replace function public.olnu_snap_anon_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.user_id is distinct from old.user_id then
      new.bytes := null;
      new.size := 0;
      new.expires_at := least(new.expires_at, now());
    end if;
  exception when others then null;
  end;
  return new;
end; $$;
create or replace trigger snap_photos_anon before update of user_id on public.snap_photos
  for each row execute function public.olnu_snap_anon_tg();

-- Keep history (0029) switched on/off: move the group's live snap photos to the new expiry.
create or replace function public.olnu_snap_keep_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    update public.snap_photos sp
       set expires_at = public.olnu_snap_exp(sp.kind, sp.group_id, sp.night, sp.reveal_at)
     where sp.group_id = new.group_id and sp.bytes is not null and sp.expires_at > now();
  exception when others then null;
  end;
  return null;
end; $$;
do $$
begin
  if to_regclass('public.group_settings') is not null then
    execute 'create or replace trigger group_settings_snaps after insert or update of keep_history on public.group_settings '
         || 'for each row execute function public.olnu_snap_keep_tg()';
  end if;
end $$;

do $$
declare
  v_h text := 'public.olnu_snap_decode(text, integer, integer), public.olnu_snap_exp(text, uuid, timestamptz, timestamptz), '
    || 'public.olnu_snap_sweep(), public.olnu_skal_can(uuid, uuid), public.olnu_skal_from(), '
    || 'public.olnu_skal_win_from(timestamptz), public.olnu_skal_win_to(timestamptz), public.olnu_snap_anon_tg(), public.olnu_snap_keep_tg()';
begin
  execute 'revoke all on function ' || v_h || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || v_h || ' from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function ' || v_h || ' from authenticated'; end if;
end $$;
