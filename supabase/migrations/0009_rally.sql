-- Öl Nu v9: INKALLELSE (rally / call-out). Additive. Safe to run again.
-- A group member calls friends to a place ("🪖 Behöver män till skyttegraven! Ses på Pitchers").
-- Members answer yes / no / maybe. Everyone in the group sees "7 på väg".
-- No old RPC, parameter or returned field changes. This file has no remove-type statements and no
-- foreign keys on purpose (create-or-replace, "if not exists" and "on conflict" only).
-- Rallies live until the next 05:00 Europe/Stockholm (same as pins), or until the creator closes them.

-- ---------------------------------------------------------------------------
-- Tables (RLS on, no policies; only SECURITY DEFINER functions and the service role use them)
-- ---------------------------------------------------------------------------

create table if not exists public.rallies (
  id         bigserial primary key,
  group_id   uuid not null,
  user_id    uuid not null,
  body       text not null check (char_length(body) between 1 and 100),
  place      text check (place is null or char_length(place) <= 60),
  lat        float8,
  lng        float8,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default public.olnu_next_expiry(),
  closed     boolean not null default false
);
create index if not exists rallies_group_idx on public.rallies (group_id, id);
create index if not exists rallies_user_idx  on public.rallies (user_id, created_at);

create table if not exists public.rally_answers (
  rally_id   bigint not null,
  user_id    uuid not null,
  answer     text not null check (answer in ('yes', 'no', 'maybe')),
  updated_at timestamptz not null default now(),
  notified   boolean not null default false,
  primary key (rally_id, user_id)
);

alter table public.rallies       enable row level security;
alter table public.rally_answers enable row level security;

revoke all on table public.rallies, public.rally_answers from public;
revoke all on sequence public.rallies_id_seq from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.rallies, public.rally_answers from anon';
    execute 'revoke all on sequence public.rallies_id_seq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.rallies, public.rally_answers from authenticated';
    execute 'revoke all on sequence public.rallies_id_seq from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.rallies, public.rally_answers to service_role';
    execute 'grant all on sequence public.rallies_id_seq to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helper (internal, not callable by clients)
-- ---------------------------------------------------------------------------

-- Live, open rallies visible to p_uid (only groups p_uid is a member of), newest first, max 10.
-- p_group_id null = all of p_uid's groups. Counts and yes_names only include current members.
-- name = creator's display_name in that group (null if the creator left).
create or replace function public.olnu_rally_rows(p_uid uuid, p_group_id uuid)
returns table (id bigint, name text, body text, place text, lat float8, lng float8,
               created_at timestamptz, yes int, no int, maybe int, my_answer text,
               yes_names text[], is_mine bool, group_id uuid, group_name text)
language sql
stable
set search_path = public
as $$
  select r.id,
         cm.display_name,
         r.body, r.place, r.lat, r.lng, r.created_at,
         coalesce(c.y, 0), coalesce(c.n, 0), coalesce(c.m, 0),
         (select a.answer from public.rally_answers a where a.rally_id = r.id and a.user_id = p_uid),
         coalesce(c.names, array[]::text[]),
         (r.user_id = p_uid),
         r.group_id,
         g.name
    from public.rallies r
    join public.group_members me on me.group_id = r.group_id and me.user_id = p_uid
    left join public.groups g on g.id = r.group_id
    left join public.group_members cm on cm.group_id = r.group_id and cm.user_id = r.user_id
    left join lateral (
      select count(*) filter (where a.answer = 'yes')::int   as y,
             count(*) filter (where a.answer = 'no')::int    as n,
             count(*) filter (where a.answer = 'maybe')::int as m,
             array_agg(gm.display_name order by (a.user_id = r.user_id) desc, a.updated_at, gm.display_name)
               filter (where a.answer = 'yes') as names
        from public.rally_answers a
        join public.group_members gm on gm.group_id = r.group_id and gm.user_id = a.user_id
       where a.rally_id = r.id
    ) c on true
   where r.expires_at > now()
     and not r.closed
     and (p_group_id is null or r.group_id = p_group_id)
   order by r.created_at desc, r.id desc
   limit 10;
$$;

revoke all on function public.olnu_rally_rows(uuid, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_rally_rows(uuid, uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_rally_rows(uuid, uuid) from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- create_rally(p_group_id, p_body, p_place default null, p_lat default null, p_lng default null) -> json {id}
-- Errors: not_member, invalid_msg (body > 100 or place > 60 after trim), slow_down (1 per 3 min per user).
-- Empty body -> 'Behöver förstärkning!'. lat/lng are kept only when both are inside Sweden (else ignored).
-- The creator is answered 'yes' (notified, so no "på väg" push to self). Older open rallies by the same
-- user in the same group are closed.
create or replace function public.create_rally(p_group_id uuid, p_body text, p_place text default null,
                                               p_lat float8 default null, p_lng float8 default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.olnu_uid();
  v_body  text := btrim(regexp_replace(coalesce(p_body, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
  v_place text := btrim(regexp_replace(coalesce(p_place, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
  v_lat   float8;
  v_lng   float8;
  v_id    bigint;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if v_body = '' then
    v_body := 'Behöver förstärkning!';
  end if;
  if char_length(v_body) > 100 or char_length(v_place) > 60 then
    raise exception 'invalid_msg';
  end if;
  if p_lat is not null and p_lng is not null
     and p_lat not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lng not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lat between 55.0 and 69.1 and p_lng between 10.9 and 24.2 then
    v_lat := round(p_lat::numeric, 5)::float8;
    v_lng := round(p_lng::numeric, 5)::float8;
  end if;

  -- Serialize per user so two fast calls cannot both pass the rate limit.
  perform pg_advisory_xact_lock(hashtextextended('olnu_rally:' || v_uid::text, 0));
  if exists (select 1 from public.rallies r
              where r.user_id = v_uid and r.created_at > now() - interval '3 minutes') then
    raise exception 'slow_down';
  end if;

  update public.rallies set closed = true
   where user_id = v_uid and group_id = p_group_id and not closed;

  insert into public.rallies (group_id, user_id, body, place, lat, lng, expires_at)
  values (p_group_id, v_uid, v_body, nullif(v_place, ''), v_lat, v_lng, public.olnu_next_expiry())
  returning rallies.id into v_id;

  insert into public.rally_answers (rally_id, user_id, answer, notified)
  values (v_id, v_uid, 'yes', true)
  on conflict (rally_id, user_id) do update set answer = 'yes', updated_at = now(), notified = true;

  return json_build_object('id', v_id);
end;
$$;

-- answer_rally(p_rally_id, p_answer) -> json {yes, no, maybe, mine}
-- Errors: invalid_answer, rally_not_found (missing, expired, closed), not_member.
-- Upsert. A changed answer keeps its notified flag (so yes -> no -> yes does not push twice).
create or replace function public.answer_rally(p_rally_id bigint, p_answer text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.olnu_uid();
  v_answer text := lower(btrim(coalesce(p_answer, '')));
  v_gid    uuid;
  v_y int; v_n int; v_m int;
begin
  if v_answer not in ('yes', 'no', 'maybe') then
    raise exception 'invalid_answer';
  end if;
  select r.group_id into v_gid
    from public.rallies r
   where r.id = p_rally_id and r.expires_at > now() and not r.closed;
  if not found then
    raise exception 'rally_not_found';
  end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_gid and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;

  insert into public.rally_answers (rally_id, user_id, answer)
  values (p_rally_id, v_uid, v_answer)
  on conflict (rally_id, user_id) do update set answer = excluded.answer, updated_at = now();

  select count(*) filter (where a.answer = 'yes')::int,
         count(*) filter (where a.answer = 'no')::int,
         count(*) filter (where a.answer = 'maybe')::int
    into v_y, v_n, v_m
    from public.rally_answers a
    join public.group_members gm on gm.group_id = v_gid and gm.user_id = a.user_id
   where a.rally_id = p_rally_id;

  return json_build_object('yes', v_y, 'no', v_n, 'maybe', v_m, 'mine', v_answer);
end;
$$;

-- close_rally(p_rally_id) -> void. Creator only, else rally_not_found. Closing twice is fine.
create or replace function public.close_rally(p_rally_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  update public.rallies set closed = true where id = p_rally_id and user_id = v_uid;
  if not found then
    raise exception 'rally_not_found';
  end if;
end;
$$;

-- group_rallies(p_group_id) -> setof (id, name, body, place, lat, lng, created_at, yes, no, maybe,
--   my_answer, yes_names, is_mine). Live and open, newest first, max 10. Error: not_member.
create or replace function public.group_rallies(p_group_id uuid)
returns table (id bigint, name text, body text, place text, lat float8, lng float8,
               created_at timestamptz, yes int, no int, maybe int, my_answer text,
               yes_names text[], is_mine bool)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return query
  select r.id, r.name, r.body, r.place, r.lat, r.lng, r.created_at, r.yes, r.no, r.maybe,
         r.my_answer, r.yes_names, r.is_mine
    from public.olnu_rally_rows(v_uid, p_group_id) r;
end;
$$;

-- my_rallies() -> same columns as group_rallies + group_id, group_name. All the caller's groups,
-- live and open, newest first, max 10 (for the HUD banner).
create or replace function public.my_rallies()
returns table (id bigint, name text, body text, place text, lat float8, lng float8,
               created_at timestamptz, yes int, no int, maybe int, my_answer text,
               yes_names text[], is_mine bool, group_id uuid, group_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select r.id, r.name, r.body, r.place, r.lat, r.lng, r.created_at, r.yes, r.no, r.maybe,
         r.my_answer, r.yes_names, r.is_mine, r.group_id, r.group_name
    from public.olnu_rally_rows(v_uid, null) r;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
  fns text[] := array[
    'public.create_rally(uuid, text, text, float8, float8)',
    'public.answer_rally(bigint, text)',
    'public.close_rally(bigint)',
    'public.group_rallies(uuid)',
    'public.my_rallies()'
  ];
begin
  foreach f in array fns loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;
