-- Öl Nu update: other drinks (sidospår) + group status. Paste ALL into Supabase → SQL Editor → Run. Safe to run again.

-- Öl Nu v8: "annan drink" (sidospår) + group status. Additive. Safe to run again.
-- Other drinks never count as beers, never change streaks, titles or milestones.
alter table public.beers add column if not exists other_count int not null default 0;
alter table public.beers add column if not exists other_kind text;
alter table public.beers add column if not exists other_at timestamptz;

-- post_other(p_kind, p_lat, p_lng, p_precise) -> json {accepted, wait_seconds, id, beer_count, other_count, other_kind, expires_at}
-- p_kind in: rom, vin, cider, drink, shot, whisky, annat. 10 min cooldown between other drinks.
-- Moves the pin like a beer. Errors: outside_sweden, invalid_kind, not_authenticated.
create or replace function public.post_other(p_kind text, p_lat float8, p_lng float8, p_precise bool)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_precise boolean := coalesce(p_precise, false);
  v_lat float8; v_lng float8;
  v_row public.beers%rowtype;
  v_accepted boolean := true;
  v_wait int := 0;
  v_cooldown constant interval := interval '10 minutes';
begin
  if v_kind not in ('rom', 'vin', 'cider', 'drink', 'shot', 'whisky', 'annat') then
    raise exception 'invalid_kind';
  end if;
  if p_lat is null or p_lng is null
     or p_lat in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lng in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lat < 55.0 or p_lat > 69.1 or p_lng < 10.9 or p_lng > 24.2 then
    raise exception 'outside_sweden';
  end if;
  if v_precise then
    v_lat := round(p_lat::numeric, 5)::float8; v_lng := round(p_lng::numeric, 5)::float8;
  else
    v_lat := (round(p_lat::numeric / 0.005) * 0.005)::float8; v_lng := (round(p_lng::numeric / 0.01) * 0.01)::float8;
  end if;
  delete from public.beers where user_id = v_uid and expires_at <= now();
  select * into v_row from public.beers where user_id = v_uid for update;
  if found then
    if v_row.other_at is not null and v_row.other_at > now() - v_cooldown then
      v_accepted := false;
      v_wait := greatest(1, ceil(extract(epoch from (v_row.other_at + v_cooldown - now())))::int);
    else
      update public.beers set lat = v_lat, lng = v_lng, precise = v_precise,
             other_count = other_count + 1, other_kind = v_kind, other_at = now(),
             updated_at = now(), stopped = false
       where id = v_row.id returning * into v_row;
    end if;
  else
    insert into public.beers (user_id, lat, lng, precise, expires_at, beer_count, other_count, other_kind, other_at)
    values (v_uid, v_lat, v_lng, v_precise, public.olnu_next_expiry(), 0, 1, v_kind, now())
    on conflict (user_id) do nothing returning * into v_row;
    if v_row.id is null then
      select * into v_row from public.beers where user_id = v_uid;
      v_accepted := false;
      v_wait := greatest(1, ceil(extract(epoch from (coalesce(v_row.other_at, now()) + v_cooldown - now())))::int);
    end if;
  end if;
  return json_build_object('accepted', v_accepted, 'wait_seconds', v_wait, 'id', v_row.id,
    'beer_count', v_row.beer_count, 'other_count', v_row.other_count, 'other_kind', v_row.other_kind,
    'expires_at', v_row.expires_at);
end; $$;

-- live_others() -> setof (beer_id, other_count, other_kind) for live, not stopped rows with other drinks.
create or replace function public.live_others()
returns table (beer_id bigint, other_count int, other_kind text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.olnu_uid();
  return query
  select b.id, b.other_count, b.other_kind from public.beers b
   where b.expires_at > now() and not b.stopped and b.other_count > 0
   order by b.id;
end; $$;

-- group_status(p_group_id) -> setof (name, beers, others, other_kind, live, total, is_me)
-- Every member of the group (also those not out). beers/others = tonight (0 if no row tonight).
-- live = has a visible pin now. total = lifetime beers. Error: not_member.
create or replace function public.group_status(p_group_id uuid)
returns table (name text, beers int, others int, other_kind text, live bool, total int, is_me bool)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return query
  select gm.display_name,
         coalesce(case when b.expires_at > now() then b.beer_count end, 0)::int,
         coalesce(case when b.expires_at > now() then b.other_count end, 0)::int,
         case when b.expires_at > now() then b.other_kind end,
         coalesce(b.expires_at > now() and not b.stopped, false),
         public.olnu_lifetime(gm.user_id),
         (gm.user_id = v_uid)
    from public.group_members gm
    left join public.beers b on b.user_id = gm.user_id
   where gm.group_id = p_group_id
   order by 2 desc, 3 desc, 1;
end; $$;

revoke all on function public.post_other(text, float8, float8, bool), public.live_others(), public.group_status(uuid) from public, anon;
grant execute on function public.post_other(text, float8, float8, bool), public.live_others(), public.group_status(uuid) to authenticated;
