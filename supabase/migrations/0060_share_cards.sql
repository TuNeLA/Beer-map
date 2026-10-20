-- 0060 LÄNKKORT (link previews for WhatsApp / Messenger / iMessage). Client: docs/js/cards.js (window.CARDS).
-- Edge function `card` (verify_jwt false, read-only) turns /card?t=<kind>&id=<id> into og:title / og:description /
-- og:image and sends real users on to the app link.
--
-- Kinds and what a link may show (only safe aggregate data, never member names except the rally sender):
--   invite            (no id)          : live drinkers on the map right now (the map is public anyway)
--   join   id = group code (6)         : group name, members, out now   (the code already lets you join)
--   duelinv id = duel token (8)        : challenger group name, members (the token already lets you accept)
--   group  id = share token (10)       : group name, members, out now                     -> chat link
--   rally  id = share token            : group name, bar name, sender first name, yes / maybe answers
--   duel   id = share token            : both group names, live or final drink score
--   paper  id = share token            : group name, people out and drinks last night (Morgontidningen)
-- Share tokens are random (10 chars, 50 bits), made by a member with share_card() and they expire.
-- Rally / duel ids are sequential, so they are NEVER accepted as a card id directly.
--
-- card_public() is for the edge function only (service_role). It has a per-IP and a global rate limit
-- (fixed 4096 bucket rows + 1 global row, so the table never grows).
-- Additive only. Needs 0001 (groups, group_members, beers, olnu_uid), 0009 (rallies, rally_answers),
-- 0031 (duels, duel_tokens, olnu_duel_side, olnu_duel_token). Safe to run again.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.share_cards (
  token       text primary key,
  kind        text not null check (kind in ('group', 'rally', 'duel', 'paper')),
  group_id    uuid not null,
  ref_id      bigint null,                 -- rally id / duel id
  user_id     uuid not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  hits        int not null default 0,
  last_hit_at timestamptz null
);
create index if not exists share_cards_user_idx on public.share_cards (user_id, created_at desc);
create index if not exists share_cards_ref_idx on public.share_cards (kind, group_id, ref_id, user_id, expires_at desc);
alter table public.share_cards enable row level security;

create table if not exists public.card_rl (
  bucket  int primary key,                 -- 0..4095 = hashed client IP, -1 = global
  minute  timestamptz not null,
  n       int not null default 0
);
alter table public.card_rl enable row level security;

revoke all on table public.share_cards, public.card_rl from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.share_cards, public.card_rl from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.share_cards, public.card_rl from authenticated';
  end if;
end $$;

-- 10-char token from the same unambiguous alphabet as group codes.
create or replace function public.olnu_card_token()
returns text language sql volatile set search_path = public as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '' order by i)
    from (select extensions.gen_random_bytes(10) b) x, generate_series(0, 9) i;
$$;

-- First word of a display name, max 20 chars (the rally sender; the push already shows it).
create or replace function public.olnu_card_first(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(left(split_part(btrim(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g')), ' ', 1), 20), '');
$$;

-- Members of a group with a live, visible pin (ghost pins are not counted on a public card).
create or replace function public.olnu_card_out(p_group uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.group_members m
    join public.beers b on b.user_id = m.user_id and b.expires_at > now() and not b.stopped and not coalesce(b.ghost, false)
   where m.group_id = p_group;
$$;

-- share_card(kind, group id, ref) -> {token, expires_at, kind}
--   kind 'group' | 'paper': ref null.  'rally': ref = rally id of that group.  'duel': ref = duel id of that group.
--   The caller must be a member of the group. The same live token is given back (no table growth).
create or replace function public.share_card(p_kind text, p_group_id uuid, p_ref bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_exp timestamptz;
  v_ref bigint := null;
  c public.share_cards;
  i int := 0;
begin
  if v_kind not in ('group', 'rally', 'duel', 'paper') then raise exception 'bad_kind'; end if;
  if p_group_id is null or not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if v_kind = 'rally' then
    select r.id, r.expires_at + interval '12 hours' into v_ref, v_exp
      from public.rallies r where r.id = p_ref and r.group_id = p_group_id;
    if v_ref is null then raise exception 'not_found'; end if;
  elsif v_kind = 'duel' then
    select d.id, d.ends_at + interval '1 day' into v_ref, v_exp
      from public.duels d where d.id = p_ref and (d.group_a = p_group_id or d.group_b = p_group_id)
       and d.status in ('pending', 'active');
    if v_ref is null then raise exception 'not_found'; end if;
  elsif v_kind = 'paper' then
    v_exp := now() + interval '3 days';
  else
    v_exp := now() + interval '30 days';
  end if;
  select * into c from public.share_cards s
   where s.kind = v_kind and s.group_id = p_group_id and s.ref_id is not distinct from v_ref and s.user_id = v_uid
     and s.expires_at > now() + interval '1 hour'
   order by s.expires_at desc limit 1;
  if found then
    return jsonb_build_object('token', c.token, 'expires_at', c.expires_at, 'kind', c.kind);
  end if;
  if (select count(*) from public.share_cards s where s.user_id = v_uid and s.created_at > now() - interval '1 hour') >= 40 then
    raise exception 'slow_down';
  end if;
  loop
    i := i + 1;
    begin
      insert into public.share_cards (token, kind, group_id, ref_id, user_id, expires_at)
      values (public.olnu_card_token(), v_kind, p_group_id, v_ref, v_uid, v_exp)
      returning * into c;
      exit;
    exception when unique_violation then
      if i >= 5 then raise exception 'code_generation_failed'; end if;
    end;
  end loop;
  return jsonb_build_object('token', c.token, 'expires_at', c.expires_at, 'kind', c.kind);
end; $$;

-- Rate limit: true = go. Fixed-size table: 4096 IP buckets + 1 global row.
create or replace function public.olnu_card_rl(p_ip text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_min timestamptz := date_trunc('minute', now());
  v_b int := abs(hashtext('olnu-card:' || coalesce(p_ip, '-'))) % 4096;
  v_n int; v_g int;
begin
  insert into public.card_rl as r (bucket, minute, n) values (v_b, v_min, 1)
  on conflict (bucket) do update set n = case when r.minute = v_min then r.n + 1 else 1 end, minute = v_min
  returning n into v_n;
  insert into public.card_rl as r (bucket, minute, n) values (-1, v_min, 1)
  on conflict (bucket) do update set n = case when r.minute = v_min then r.n + 1 else 1 end, minute = v_min
  returning n into v_g;
  return v_n <= 60 and v_g <= 1500;
end; $$;

-- card_public(kind, id, ip) -> jsonb (never null; {ok:false} when unknown / expired / limited).
-- Only safe aggregate fields. 'go' = what the app link needs (query part), built here so the function has no logic.
create or replace function public.card_public(p_kind text, p_id text default null, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_id text := upper(regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g'));
  g public.groups;
  c public.share_cards;
  r public.rallies;
  d public.duels;
  t public.duel_tokens;
  sa jsonb; sb jsonb;
  v_status text;
begin
  if not public.olnu_card_rl(p_ip) then return jsonb_build_object('ok', false, 'why', 'limited'); end if;
  if v_kind = 'invite' then
    return jsonb_build_object('ok', true, 'kind', 'invite', 'go', 'invite=1',
      'out', (select count(*) from public.beers b where b.expires_at > now() and not b.stopped and not coalesce(b.ghost, false))::int);
  end if;
  if v_kind = 'join' then
    if char_length(v_id) <> 6 then return jsonb_build_object('ok', false); end if;
    select * into g from public.groups x where upper(x.code) = v_id;
    if not found then return jsonb_build_object('ok', false); end if;
    return jsonb_build_object('ok', true, 'kind', 'join', 'go', 'join=' || g.code, 'group', g.name,
      'members', (select count(*) from public.group_members m where m.group_id = g.id)::int,
      'out', public.olnu_card_out(g.id));
  end if;
  if v_kind = 'duelinv' then
    if char_length(v_id) <> 8 then return jsonb_build_object('ok', false); end if;
    select * into t from public.duel_tokens x where x.token = v_id and x.expires_at > now();
    if not found then return jsonb_build_object('ok', false, 'go', ''); end if;
    return jsonb_build_object('ok', true, 'kind', 'duelinv', 'go', 'duel=' || t.token,
      'group', (select x.name from public.groups x where x.id = t.group_id),
      'members', (select count(*) from public.group_members m where m.group_id = t.group_id)::int,
      'out', public.olnu_card_out(t.group_id), 'expires_at', t.expires_at);
  end if;
  if v_kind not in ('group', 'rally', 'duel', 'paper') or char_length(v_id) <> 10 then return jsonb_build_object('ok', false); end if;
  update public.share_cards s set hits = s.hits + 1, last_hit_at = now()
   where s.token = v_id and s.kind = v_kind and s.expires_at > now()
   returning * into c;
  if not found then return jsonb_build_object('ok', false); end if;
  select * into g from public.groups x where x.id = c.group_id;
  if not found then return jsonb_build_object('ok', false); end if;
  if v_kind = 'group' then
    return jsonb_build_object('ok', true, 'kind', 'group', 'go', 'chat=' || g.id::text, 'group', g.name,
      'members', (select count(*) from public.group_members m where m.group_id = g.id)::int,
      'out', public.olnu_card_out(g.id));
  end if;
  if v_kind = 'paper' then
    -- Last night: pins of members that ended within the last 20 h (or are still live).
    return jsonb_build_object('ok', true, 'kind', 'paper', 'go', '', 'group', g.name,
      'members', (select count(*) from public.group_members m where m.group_id = g.id)::int,
      'people', (select count(*) from public.group_members m join public.beers b on b.user_id = m.user_id
                  where m.group_id = g.id and b.expires_at > now() - interval '20 hours' and coalesce(b.beer_count, 0) + coalesce(b.other_count, 0) > 0)::int,
      'drinks', (select coalesce(sum(coalesce(b.beer_count, 0) + coalesce(b.other_count, 0)), 0) from public.group_members m join public.beers b on b.user_id = m.user_id
                  where m.group_id = g.id and b.expires_at > now() - interval '20 hours')::int);
  end if;
  if v_kind = 'rally' then
    select * into r from public.rallies x where x.id = c.ref_id;
    if not found then return jsonb_build_object('ok', false); end if;
    return jsonb_build_object('ok', true, 'kind', 'rally', 'go', 'rally=' || r.id::text, 'group', g.name,
      'place', r.place,
      'sender', public.olnu_card_first((select m.display_name from public.group_members m where m.group_id = r.group_id and m.user_id = r.user_id)),
      'yes', (select count(*) from public.rally_answers a where a.rally_id = r.id and a.answer = 'yes')::int,
      'maybe', (select count(*) from public.rally_answers a where a.rally_id = r.id and a.answer = 'maybe')::int,
      'live', not r.closed and r.expires_at > now(), 'at', r.created_at);
  end if;
  -- duel
  select * into d from public.duels x where x.id = c.ref_id;
  if not found then return jsonb_build_object('ok', false); end if;
  v_status := case when d.status = 'active' and (d.finished_at is not null or d.ends_at <= now()) then 'done'
                   when d.status = 'pending' and (d.answer_by <= now() or d.ends_at <= now()) then 'expired'
                   else d.status end;
  if d.finished_at is not null then
    sa := jsonb_build_object('drinks', d.drinks_a); sb := jsonb_build_object('drinks', d.drinks_b);
  elsif d.status = 'active' then
    sa := public.olnu_duel_side(d.id, 'a'); sb := public.olnu_duel_side(d.id, 'b');
  else
    sa := jsonb_build_object('drinks', 0); sb := jsonb_build_object('drinks', 0);
  end if;
  -- Side "us" = the group whose member made the link.
  return jsonb_build_object('ok', true, 'kind', 'duel', 'go', '', 'status', v_status,
    'group', (select x.name from public.groups x where x.id = case when d.group_a = c.group_id then d.group_a else d.group_b end),
    'opp', (select x.name from public.groups x where x.id = case when d.group_a = c.group_id then d.group_b else d.group_a end),
    'us', coalesce((case when d.group_a = c.group_id then sa else sb end)->>'drinks', '0')::int,
    'them', coalesce((case when d.group_a = c.group_id then sb else sa end)->>'drinks', '0')::int,
    'winner', case when d.winner is null then null when d.winner = 'draw' then 'draw'
                   when (d.winner = 'a') = (d.group_a = c.group_id) then 'us' else 'them' end);
end; $$;

revoke all on function public.olnu_card_token(), public.olnu_card_first(text), public.olnu_card_out(uuid),
  public.share_card(text, uuid, bigint), public.olnu_card_rl(text), public.card_public(text, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_card_token(), public.olnu_card_first(text), public.olnu_card_out(uuid), public.share_card(text, uuid, bigint), public.olnu_card_rl(text), public.card_public(text, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_card_token(), public.olnu_card_first(text), public.olnu_card_out(uuid), public.olnu_card_rl(text), public.card_public(text, text, text) from authenticated';
    execute 'grant execute on function public.share_card(text, uuid, bigint) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.card_public(text, text, text) to service_role';
  end if;
end $$;
