-- Öl Nu v3 — Skål! (cheers).
-- Binding spec: CONTRACT.md, section "v3 CHANGES → Skål! (cheers) — backend".
-- Run after 0001_olnu.sql. Safe to run again.
--
-- Skåls reset with the night: post_beer (0001) deletes the caller's expired row
-- before it inserts a new one, and skals.beer_id cascades on that delete.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.skals (
  beer_id     bigint not null references public.beers(id) on delete cascade,
  user_id     uuid not null,
  created_at  timestamptz not null default now(),
  primary key (beer_id, user_id)
);

-- RLS: on, no policies. Also drop the default Supabase table grants.
alter table public.skals enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.skals from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.skals from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- skal(p_beer_id) -> json {skal_count, already}
-- Beer must be live (not expired, not stopped) else beer_not_found.
-- Own beer -> own_beer. One skål per caller per beer.
create or replace function public.skal(p_beer_id bigint)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.olnu_uid();
  v_owner   uuid;
  v_count   int;
  v_already boolean := false;
  v_rows    int;
begin
  select b.user_id into v_owner
    from public.beers b
   where b.id = p_beer_id
     and b.expires_at > now()
     and not b.stopped;
  if not found then
    raise exception 'beer_not_found';
  end if;

  if v_owner = v_uid then
    raise exception 'own_beer';
  end if;

  insert into public.skals (beer_id, user_id)
  values (p_beer_id, v_uid)
  on conflict (beer_id, user_id) do nothing;
  get diagnostics v_rows = row_count;
  v_already := (v_rows = 0);

  select count(*)::int into v_count from public.skals s where s.beer_id = p_beer_id;

  return json_build_object('skal_count', v_count, 'already', v_already);
end;
$$;

-- live_beers() -> setof (id, lat, lng, beer_count, precise, created_at, is_mine,
--                        friend_name, skal_count, i_skaled)
-- Same as 0001 plus the two skål columns at the end. Excludes stopped and expired rows.
drop function if exists public.live_beers();
create or replace function public.live_beers()
returns table (
  id          bigint,
  lat         float8,
  lng         float8,
  beer_count  int,
  precise     bool,
  created_at  timestamptz,
  is_mine     bool,
  friend_name text,
  skal_count  int,
  i_skaled    bool
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select b.id, b.lat, b.lng, b.beer_count, b.precise, b.created_at,
         (b.user_id = v_uid) as is_mine,
         case when b.user_id = v_uid then null
              else (select min(am.display_name)
                      from public.group_members am
                      join public.group_members cm
                        on cm.group_id = am.group_id and cm.user_id = v_uid
                     where am.user_id = b.user_id)
         end as friend_name,
         (select count(*)::int from public.skals s where s.beer_id = b.id) as skal_count,
         exists (select 1 from public.skals s where s.beer_id = b.id and s.user_id = v_uid) as i_skaled
    from public.beers b
   where b.expires_at > now()
     and not b.stopped
   order by b.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only
-- ---------------------------------------------------------------------------

revoke all on function public.skal(bigint)  from public;
revoke all on function public.live_beers()  from public;

do $$
declare
  f text;
  fns text[] := array[
    'public.skal(bigint)',
    'public.live_beers()'
  ];
begin
  foreach f in array fns loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;
