-- 0125 (social2) Event links that work WITHOUT the app: ?ev=<6-char code>.
-- A participant of an invite (0080) makes a link; anyone with it sees the event (title, time, place, how many come,
-- first letters of who comes, the creator's FIRST name) and answers ✅ / 🤔 in the browser with a name only.
-- The 6-char code (same alphabet as group codes) can also be typed in Grupper → Gå med (fallback after install).
-- Answering adds the caller to invite_people (invited_by = the link maker), then the normal invite_answer runs, so the
-- event chat system line (trigger olnu_tg_ans), push_yes and everything else work as for a normal invite.
-- card_public (0060) gets kind 'ev' and 'faces' for join/group cards (additive fields only).
-- No row is ever removed by this file. Safe to run again.

create table if not exists public.ev_links (
  token      text primary key check (token ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  invite_id  bigint not null references public.invites(id),
  creator    uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  hits       int not null default 0,
  joins      int not null default 0
);
create index if not exists ev_links_inv on public.ev_links (invite_id, creator);
create index if not exists ev_links_creator on public.ev_links (creator, created_at desc);
alter table public.ev_links enable row level security;
revoke all on table public.ev_links from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on table public.ev_links from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on table public.ev_links from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant all on table public.ev_links to service_role'; end if;
end $$;

create or replace function public.olnu_ev_token()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  t text;
  i int;
  n int := 0;
begin
  loop
    n := n + 1;
    t := '';
    for i in 1..6 loop t := t || substr(a, 1 + floor(random() * 32)::int, 1); end loop;
    exit when not exists (select 1 from public.ev_links l where l.token = t)
          and not exists (select 1 from public.groups g where upper(g.code) = t);
    if n > 20 then raise exception 'code_generation_failed'; end if;
  end loop;
  return t;
end;
$$;

-- faces: first letters of ✅ people (creator first), max 4
create or replace function public.olnu_ev_faces(p_inv bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(f.i), '[]'::jsonb) from (
    select upper(left(btrim(coalesce(public.olnu_friend_name(p.user_id), '?')), 1)) as i
      from public.invite_people p join public.invites i on i.id = p.invite_id
     where p.invite_id = p_inv and p.answer = 'yes'
     order by (p.user_id = i.creator) desc, p.answered_at nulls last
     limit 4) f;
$$;

create or replace function public.ev_link(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  i public.invites;
  v_ans text;
  l public.ev_links;
  n int := 0;
begin
  select * into i from public.invites x where x.id = p_id;
  select p.answer into v_ans from public.invite_people p where p.invite_id = p_id and p.user_id = v_uid;
  if i.id is null or v_ans is null then raise exception 'invite_not_found'; end if;
  if i.status <> 'open' or i.ends_at <= now() then raise exception 'invite_over'; end if;
  if v_ans = 'no' then raise exception 'invite_not_found'; end if;
  select * into l from public.ev_links x where x.invite_id = p_id and x.creator = v_uid and x.expires_at > now() order by x.created_at desc limit 1;
  if found then return jsonb_build_object('token', l.token, 'expires_at', l.expires_at); end if;
  if (select count(*) from public.ev_links x where x.creator = v_uid and x.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'slow_down';
  end if;
  loop
    n := n + 1;
    begin
      insert into public.ev_links (token, invite_id, creator, expires_at)
      values (public.olnu_ev_token(), p_id, v_uid, i.ends_at) returning * into l;
      exit;
    exception when unique_violation then
      if n >= 5 then raise exception 'code_generation_failed'; end if;
    end;
  end loop;
  return jsonb_build_object('token', l.token, 'expires_at', l.expires_at);
end;
$$;

create or replace function public.olnu_ev_public(l public.ev_links, p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  i public.invites;
  v_me text;
  v_yes int; v_maybe int;
begin
  select * into i from public.invites x where x.id = l.invite_id;
  if not found then return jsonb_build_object('ok', false, 'why', 'not_found'); end if;
  select p.answer into v_me from public.invite_people p where p.invite_id = i.id and p.user_id = p_uid;
  select count(*) filter (where answer = 'yes')::int, count(*) filter (where answer = 'maybe')::int into v_yes, v_maybe
    from public.invite_people p where p.invite_id = i.id;
  return jsonb_build_object('ok', true, 'token', l.token, 'title', i.title, 'kind', i.kind, 'place', i.place,
    'starts_at', i.starts_at, 'ends_at', i.ends_at, 'status', i.status, 'live', i.status = 'open' and i.ends_at > now(),
    'from', public.olnu_card_first(public.olnu_friend_name(l.creator)),
    'creator', public.olnu_card_first(public.olnu_friend_name(i.creator)),
    'yes', v_yes, 'maybe', v_maybe, 'faces', public.olnu_ev_faces(i.id),
    'member', v_me is not null, 'my_answer', coalesce(v_me, 'none'),
    'id', case when v_me is not null then i.id end);
end;
$$;

create or replace function public.ev_preview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_t text := upper(regexp_replace(coalesce(p_token, ''), '[^A-Za-z0-9]', '', 'g'));
  l public.ev_links;
begin
  if (select count(*) from public.join_fails f where f.user_id = v_uid and f.at > now() - interval '10 minutes') >= 8 then
    return jsonb_build_object('ok', false, 'why', 'slow_down');
  end if;
  if char_length(v_t) <> 6 then return jsonb_build_object('ok', false, 'why', 'not_found'); end if;
  select * into l from public.ev_links x where x.token = v_t and x.expires_at > now();
  if not found then
    insert into public.join_fails (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'why', 'not_found');
  end if;
  update public.ev_links x set hits = x.hits + 1 where x.token = l.token;
  return public.olnu_ev_public(l, v_uid);
end;
$$;

create or replace function public.ev_join(p_token text, p_answer text default 'yes', p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_t text := upper(regexp_replace(coalesce(p_token, ''), '[^A-Za-z0-9]', '', 'g'));
  v_a text := lower(coalesce(p_answer, 'yes'));
  l public.ev_links;
  i public.invites;
  v_old text;
  r jsonb;
begin
  if v_a not in ('yes', 'maybe', 'no') then raise exception 'invalid_answer'; end if;
  if (select count(*) from public.join_fails f where f.user_id = v_uid and f.at > now() - interval '10 minutes') >= 8 then
    raise exception 'slow_down';
  end if;
  select * into l from public.ev_links x where x.token = v_t and x.expires_at > now();
  if not found then
    insert into public.join_fails (user_id) values (v_uid);
    raise exception 'invite_not_found';
  end if;
  select * into i from public.invites x where x.id = l.invite_id;
  if i.id is null then raise exception 'invite_not_found'; end if;
  if i.status <> 'open' or i.ends_at <= now() then raise exception 'invite_over'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  if public.olnu_friend_name(v_uid) is null then raise exception 'name_needed'; end if;
  select p.answer into v_old from public.invite_people p where p.invite_id = i.id and p.user_id = v_uid;
  if v_old is null then
    if (select count(*) from public.invite_people p where p.invite_id = i.id) >= 61 then raise exception 'too_many'; end if;
    if (select count(*) from public.invite_people p where p.user_id = v_uid and p.created_at > now() - interval '1 hour') >= 20 then
      raise exception 'slow_down';
    end if;
    insert into public.invite_people (invite_id, user_id, invited_by, answer, notified)
    values (i.id, v_uid, l.creator, 'none', true);
    update public.ev_links x set joins = x.joins + 1 where x.token = l.token;
  end if;
  r := public.invite_answer(i.id, v_a);
  return r || jsonb_build_object('token', l.token, 'faces', public.olnu_ev_faces(i.id));
end;
$$;

-- card_public: same as 0060 + kind 'ev' + 'faces' on join/group (additive)
create or replace function public.card_public(p_kind text, p_id text DEFAULT NULL::text, p_ip text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_id text := upper(regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g'));
  g public.groups;
  c public.share_cards;
  r public.rallies;
  d public.duels;
  t public.duel_tokens;
  l public.ev_links;
  i public.invites;
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
      'out', public.olnu_card_out(g.id), 'faces', public.olnu_card_faces(g.id));
  end if;
  if v_kind = 'ev' then
    if char_length(v_id) <> 6 then return jsonb_build_object('ok', false); end if;
    select * into l from public.ev_links x where x.token = v_id and x.expires_at > now();
    if not found then return jsonb_build_object('ok', false); end if;
    select * into i from public.invites x where x.id = l.invite_id;
    if not found or i.status <> 'open' then return jsonb_build_object('ok', false); end if;
    update public.ev_links x set hits = x.hits + 1 where x.token = l.token;
    return jsonb_build_object('ok', true, 'kind', 'ev', 'go', 'ev=' || l.token, 'title', i.title, 'place', i.place,
      'starts_at', i.starts_at, 'from', public.olnu_card_first(public.olnu_friend_name(l.creator)),
      'yes', (select count(*) from public.invite_people p where p.invite_id = i.id and p.answer = 'yes')::int,
      'maybe', (select count(*) from public.invite_people p where p.invite_id = i.id and p.answer = 'maybe')::int,
      'faces', public.olnu_ev_faces(i.id));
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
      'out', public.olnu_card_out(g.id), 'faces', public.olnu_card_faces(g.id));
  end if;
  if v_kind = 'paper' then
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
  return jsonb_build_object('ok', true, 'kind', 'duel', 'go', '', 'status', v_status,
    'group', (select x.name from public.groups x where x.id = case when d.group_a = c.group_id then d.group_a else d.group_b end),
    'opp', (select x.name from public.groups x where x.id = case when d.group_a = c.group_id then d.group_b else d.group_a end),
    'us', coalesce((case when d.group_a = c.group_id then sa else sb end)->>'drinks', '0')::int,
    'them', coalesce((case when d.group_a = c.group_id then sb else sa end)->>'drinks', '0')::int,
    'winner', case when d.winner is null then null when d.winner = 'draw' then 'draw'
                   when (d.winner = 'a') = (d.group_a = c.group_id) then 'us' else 'them' end);
end; $function$;

create or replace function public.olnu_card_faces(p_group uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(f.i), '[]'::jsonb) from (
    select upper(left(btrim(coalesce(m.display_name, '?')), 1)) as i
      from public.group_members m
      left join public.beers b on b.user_id = m.user_id and b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false)
     where m.group_id = p_group
     order by (b.user_id is not null) desc, m.joined_at
     limit 4) f;
$$;

revoke all on function public.olnu_ev_token() from public;
revoke all on function public.olnu_ev_faces(bigint) from public;
revoke all on function public.olnu_ev_public(public.ev_links, uuid) from public;
revoke all on function public.olnu_card_faces(uuid) from public;
revoke all on function public.ev_link(bigint) from public;
revoke all on function public.ev_preview(text) from public;
revoke all on function public.ev_join(text, text, text) from public;
revoke all on function public.card_public(text, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_ev_token() from anon';
    execute 'revoke all on function public.olnu_ev_faces(bigint) from anon';
    execute 'revoke all on function public.olnu_ev_public(public.ev_links, uuid) from anon';
    execute 'revoke all on function public.olnu_card_faces(uuid) from anon';
    execute 'revoke all on function public.ev_link(bigint) from anon';
    execute 'revoke all on function public.ev_preview(text) from anon';
    execute 'revoke all on function public.ev_join(text, text, text) from anon';
    execute 'revoke all on function public.card_public(text, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_ev_token() from authenticated';
    execute 'revoke all on function public.olnu_ev_faces(bigint) from authenticated';
    execute 'revoke all on function public.olnu_ev_public(public.ev_links, uuid) from authenticated';
    execute 'revoke all on function public.olnu_card_faces(uuid) from authenticated';
    execute 'revoke all on function public.card_public(text, text, text) from authenticated';
    execute 'grant execute on function public.ev_link(bigint) to authenticated';
    execute 'grant execute on function public.ev_preview(text) to authenticated';
    execute 'grant execute on function public.ev_join(text, text, text) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.card_public(text, text, text) to service_role';
  end if;
end $$;
