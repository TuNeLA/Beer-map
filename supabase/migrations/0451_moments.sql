-- 0451 after (GM7, owner OK 10 Nov: moments ship in the big update): games come to you at moments, never from a menu.
-- OWNER-RUN at release. Additive only: 2 new tables, new functions. Needs 0450 (after_flags, after_push_q, olnu_after_*).
-- Everything is behind after_flags.moments (default OFF). Pushes are rows in after_push_q (kind 'mom', tag olnu-mom-<id>,
-- max 2 game pushes per person per night, sent only with after_flags.moment_push on; notify-group paces them as "kul").
--
-- Moments (Europe/Stockholm, night = olnu_night_of; opened lazily by any member's moments_poll, one advisory lock per
-- group + night, so no cron is needed):
--   vad      Kvällens vad   2+ of the group said Ikväll = ute, 16:00–21:30. One bet about the gang. Closes 22:00.
--   halvtid  Halvtid        21:00–00:30 with 2+ out. One 3-option bet. Closes 60 min later.
--   bord     Uppdrag vid bordet  3+ of the group checked in at the same bar now, 18:00–01:30. One group mission, anyone
--            taps Klart. 45 min. Max 2 per group per night, 60 min apart.
--   agent    Hemlig agent (home party only): Förfest started with 3+ (moment_home_party) or 3+ of the group within 100 m,
--            not within 80 m of a bar, 17:00–22:30. One agent (random, never the starter), one mission (1–60, the text is
--            in the app). Vote at 23:00 or when the host taps Avslöja; 15 min; the agent wins = Klart + the majority wrong.
-- Rules: a person is asked in max 2 moments per night (who[]); Spökläge / ghost nights are never asked, never an option,
-- never settled. No bet, mission or result counts drinks. No money, no prizes (Oraklet is a cosmetic medal, 0452).
-- Bets settle from data (drink_log, after_nights.home_at, ikvall_status, skals): early when certain, else at 05:00.
-- Time: olnu_crew_now() (= now(); the staging tests set olnu.crew_now).
-- RPCs (authenticated): moments_poll(p_group_id), moment_pick(p_round, p_pick), moment_done(p_round),
--   moment_reveal(p_round), moment_home_party(p_group_id, p_names), moments_report(p_group_id, p_night).

create table if not exists public.moment_rounds (
  id          bigserial primary key,
  group_id    uuid not null,
  night       timestamptz not null,
  kind        text not null check (kind in ('vad', 'halvtid', 'bord', 'agent')),
  slot        int not null default 1,
  q_key       text not null default '',
  opts        jsonb not null default '[]'::jsonb,
  who         uuid[] not null default '{}',
  meta        jsonb not null default '{}'::jsonb,
  bar_id      text,
  bar_name    text,
  mission     int,
  agent       uuid,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  closes_at   timestamptz not null,
  reveal_at   timestamptz,
  revealed_at timestamptz,
  done_at     timestamptz,
  done_by     uuid,
  answer      jsonb,
  settled_at  timestamptz,
  unique (group_id, night, kind, slot)
);
create index if not exists moment_rounds_night_ix on public.moment_rounds (night, group_id);
alter table public.moment_rounds enable row level security;
revoke all on table public.moment_rounds from public, anon, authenticated;

create table if not exists public.moment_picks (
  round_id bigint not null,
  user_id  uuid not null,
  pick     text not null,
  changes  int not null default 0,
  at       timestamptz not null default now(),
  primary key (round_id, user_id)
);
alter table public.moment_picks enable row level security;
revoke all on table public.moment_picks from public, anon, authenticated;

insert into public.after_flags (key, on_) values ('moments', false), ('moment_push', false) on conflict (key) do nothing;

-- local clock of the night: 18:00 = 18, 01:30 = 25.5
create or replace function public.olnu_mom_hn(p timestamptz)
returns numeric language sql stable set search_path = public as $$
  select case when x < 12 then x + 24 else x end
    from (select extract(hour from (p at time zone 'Europe/Stockholm')) + extract(minute from (p at time zone 'Europe/Stockholm')) / 60.0 as x) q;
$$;
-- a clock time of this night ("22:00" of the evening; hn >= 24 = after midnight)
create or replace function public.olnu_mom_at(p_night timestamptz, p_hn numeric)
returns timestamptz language sql stable set search_path = public as $$
  select ((((p_night at time zone 'Europe/Stockholm')::date - 1) + make_interval(mins => (p_hn * 60)::int)) at time zone 'Europe/Stockholm');
$$;
create or replace function public.olnu_mom_asked(p_uid uuid, p_night timestamptz)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.moment_rounds r where r.night = p_night and p_uid = any (r.who);
$$;
create or replace function public.olnu_mom_qtext(p_q text)
returns text language sql immutable as $$
  select case p_q when 'first_home' then 'Vem går hem först?' when 'last_home' then 'Vem ä sist kvar på skeppet?'
    when 'bars' then 'Hur många krogar blir det för gänget?' when 'all_come' then 'Kommer alla som sa Ja?'
    when 'skal_n' then 'Hur många skål får gänget?' when 'first_out' then 'Vem ä först ute?'
    when 'last_home_t' then 'När ä sista person hemma?' else 'Kvällens vad' end;
$$;
-- the uid behind a face (crew k) of this group
create or replace function public.olnu_mom_uid(p_gid uuid, p_k text)
returns uuid language sql stable security definer set search_path = public as $$
  select m.user_id from public.group_members m where m.group_id = p_gid and public.olnu_crew_k(p_gid, m.user_id) = p_k limit 1;
$$;
create or replace function public.olnu_mom_faces(p_gid uuid, p_uids uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('v', public.olnu_crew_k(p_gid, u.uid)) order by u.ord), '[]'::jsonb)
    from unnest(p_uids) with ordinality as u(uid, ord);
$$;
create or replace function public.olnu_mom_push(p_r public.moment_rounds, p_uids uuid[], p_tag text, p_title text, p_body text, p_by uuid)
returns int language plpgsql security definer set search_path = public as $$
declare u uuid; n int := 0;
begin
  if not public.olnu_after_on('moment_push') then return 0; end if;   -- no queue rows (and no used cap) while pushes are off
  foreach u in array coalesce(p_uids, '{}') loop
    if u is distinct from p_by and public.olnu_after_q_add(u, p_r.night, 'mom', p_tag, p_title, p_body, '/?mom=' || p_r.id, p_by, null) then n := n + 1; end if;
  end loop;
  return n;
end; $$;

-- ---------- the answer of a bet / the agent result (null = not known yet) ----------
create or replace function public.olnu_mom_answer(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r public.moment_rounds; v_now timestamptz := public.olnu_crew_now(); v_end boolean; v_uids uuid[]; v_k text; v_n int;
  v_t timestamptz; v_mem uuid[]; v_votes int; v_right int; v_ak text;
begin
  select * into r from public.moment_rounds where id = p_id;
  if not found then return null; end if;
  if r.answer is not null then return r.answer; end if;
  v_end := v_now >= r.night;
  select array_agg(m.user_id) into v_mem from public.group_members m where m.group_id = r.group_id and not public.olnu_after_ghost(m.user_id, r.night);
  if r.kind = 'agent' then
    if not (v_now >= r.closes_at and (r.revealed_at is not null or v_now >= r.reveal_at)) then return null; end if;
    v_ak := public.olnu_crew_k(r.group_id, r.agent);
    select count(*), count(*) filter (where p.pick = v_ak) into v_votes, v_right from public.moment_picks p where p.round_id = r.id;
    return jsonb_build_object('v', v_ak, 'votes', v_votes, 'right', v_right, 'done', r.done_at is not null,
                              'won', r.done_at is not null and v_right * 2 < greatest(v_votes, 1));   -- Klart + under half guessed right
  end if;
  if r.kind = 'bord' then return null; end if;
  select array_agg(public.olnu_mom_uid(r.group_id, o ->> 'v')) into v_uids from jsonb_array_elements(r.opts) o;
  if r.q_key = 'first_out' then
    select public.olnu_crew_k(r.group_id, d.user_id) into v_k from public.drink_log d
     where d.user_id = any (v_uids) and d.night = r.night and not d.undone and not coalesce(d.ghost, false) order by d.at, d.id limit 1;
    if v_k is not null then return jsonb_build_object('v', v_k); end if;
    return case when v_end then jsonb_build_object('v', null, 'none', true) end;
  elsif r.q_key = 'first_home' then
    select public.olnu_crew_k(r.group_id, a.user_id) into v_k from public.after_nights a
     where a.user_id = any (v_uids) and a.night = r.night and a.home_at is not null order by a.home_at limit 1;
    if v_k is not null then return jsonb_build_object('v', v_k); end if;
    return case when v_end then jsonb_build_object('v', null, 'none', true) end;
  elsif r.q_key = 'last_home' then
    if not v_end then return null; end if;
    select public.olnu_crew_k(r.group_id, x.u) into v_k from (
      select a.user_id as u, a.home_at as t, 1 as pri from public.after_nights a where a.user_id = any (v_uids) and a.night = r.night and a.home_at is not null
      union all
      select d.user_id, max(d.at), 2 from public.drink_log d where d.user_id = any (v_uids) and d.night = r.night and not d.undone and not coalesce(d.ghost, false)
        and not exists (select 1 from public.after_nights a2 where a2.user_id = any (v_uids) and a2.night = r.night and a2.home_at is not null)
       group by d.user_id) x order by x.t desc limit 1;
    return jsonb_build_object('v', v_k, 'none', v_k is null);
  elsif r.q_key = 'bars' then
    select count(distinct d.bar_id) into v_n from public.drink_log d
     where d.user_id = any (v_mem) and d.night = r.night and d.bar_id is not null and not d.undone and not coalesce(d.ghost, false);
    if v_n >= 3 then return jsonb_build_object('v', '3+', 'n', v_n); end if;
    return case when v_end then jsonb_build_object('v', case when v_n <= 1 then '1' else '2' end, 'n', v_n) end;
  elsif r.q_key = 'all_come' then
    select array_agg(x::uuid) into v_uids from jsonb_array_elements_text(coalesce(r.meta -> 'ute', '[]'::jsonb)) x;
    if not exists (select 1 from unnest(coalesce(v_uids, '{}')) u
                    where not exists (select 1 from public.drink_log d where d.user_id = u and d.night = r.night and not d.undone and not coalesce(d.ghost, false)))
       then return jsonb_build_object('v', 'ja'); end if;
    return case when v_end then jsonb_build_object('v', 'nej') end;
  elsif r.q_key = 'skal_n' then
    select count(*) into v_n from public.skals s join public.beers b on b.id = s.beer_id
     where b.user_id = any (v_mem) and b.expires_at = r.night;
    if v_n >= 26 then return jsonb_build_object('v', '26', 'n', v_n); end if;
    return case when v_end then jsonb_build_object('v', case when v_n <= 9 then '0_9' else '10_25' end, 'n', v_n) end;
  elsif r.q_key = 'last_home_t' then
    if not v_end then return null; end if;
    select max(a.home_at) into v_t from public.after_nights a where a.user_id = any (v_mem) and a.night = r.night and a.home_at is not null;
    if v_t is null then
      select max(d.at) into v_t from public.drink_log d where d.user_id = any (v_mem) and d.night = r.night and not d.undone and not coalesce(d.ghost, false);
    end if;
    if v_t is null then return jsonb_build_object('v', null, 'none', true); end if;
    return jsonb_build_object('v', case when public.olnu_mom_hn(v_t) < 25 then 'f01' when public.olnu_mom_hn(v_t) < 26 then '01_02' else 'e02' end);
  end if;
  return null;
end; $$;

-- store a known answer (an early answer closes the betting at once)
create or replace function public.olnu_mom_settle(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  v := public.olnu_mom_answer(p_id);
  if v is null then return; end if;
  update public.moment_rounds r set answer = v, settled_at = public.olnu_crew_now(),
         closes_at = least(r.closes_at, public.olnu_crew_now())
   where r.id = p_id and r.answer is null;
end; $$;

-- ---------- start a Hemlig agent round (home party) ----------
create or replace function public.olnu_mom_agent_start(p_gid uuid, p_night timestamptz, p_present uuid[], p_by uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := public.olnu_crew_now(); v_who uuid[]; v_agent uuid; v_id bigint; r public.moment_rounds;
begin
  if exists (select 1 from public.moment_rounds x where x.group_id = p_gid and x.night = p_night and x.kind = 'agent') then return null; end if;
  if public.olnu_mom_hn(v_now) < 17 or public.olnu_mom_hn(v_now) >= 22.5 then return null; end if;
  v_who := array(select u from unnest(p_present) u where not public.olnu_after_ghost(u, p_night) and public.olnu_mom_asked(u, p_night) < 2
                   and exists (select 1 from public.group_members m where m.group_id = p_gid and m.user_id = u));
  if coalesce(array_length(v_who, 1), 0) < 3 then return null; end if;
  select u into v_agent from unnest(v_who) u where u is distinct from p_by order by random() limit 1;
  insert into public.moment_rounds (group_id, night, kind, who, mission, agent, created_by, closes_at, reveal_at)
  values (p_gid, p_night, 'agent', v_who, 1 + floor(random() * 60)::int, v_agent, p_by,
          public.olnu_mom_at(p_night, 23.25), public.olnu_mom_at(p_night, 23))
  on conflict (group_id, night, kind, slot) do nothing
  returning * into r;
  if r.id is null then return null; end if;
  perform public.olnu_mom_push(r, array[v_agent], 'olnu-mom-' || r.id, 'Du ä hemlig agent 🕵️', 'Ditt uppdrag väntar i appen. Avslöjas 23:00.', null);
  perform public.olnu_mom_push(r, array(select u from unnest(v_who) u where u <> v_agent), 'olnu-mom-' || r.id, 'En agent bland er 🕵️',
                               'Nån av er har ett hemligt uppdrag. Avslöjas 23:00.', p_by);
  return r.id;
end; $$;

-- ---------- open the moments of one group tonight (lazy trigger; any member's poll) ----------
create or replace function public.olnu_mom_open(p_gid uuid, p_by uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := public.olnu_crew_now();
  v_night timestamptz := public.olnu_night_of(v_now);
  v_hn numeric := public.olnu_mom_hn(v_now);
  v_mem uuid[]; v_ute uuid[]; v_out uuid[]; v_who uuid[]; v_q text; v_qs text[]; v_opts jsonb; v_n int := 0;
  r public.moment_rounds; v_bar text; v_barname text; v_buids uuid[]; v_used text; v_bars int; v_skal int; v_present uuid[];
begin
  if not public.olnu_after_on('moments') then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_mom:' || p_gid::text || ':' || v_night::text, 0));
  select array_agg(m.user_id order by m.joined_at) into v_mem from public.group_members m
   where m.group_id = p_gid and not public.olnu_after_ghost(m.user_id, v_night);
  if coalesce(array_length(v_mem, 1), 0) < 2 then return 0; end if;
  select array_agg(d.user_id) into v_out from (select distinct x.user_id from public.drink_log x
    where x.user_id = any (v_mem) and x.night = v_night and not x.undone and not coalesce(x.ghost, false)) d;

  -- 1. Kvällens vad
  if v_hn >= 16 and v_hn < 21.5 and not exists (select 1 from public.moment_rounds x where x.group_id = p_gid and x.night = v_night and x.kind = 'vad') then
    select array_agg(s.user_id) into v_ute from public.ikvall_status s where s.user_id = any (v_mem) and s.night = v_night and s.st = 'ute';
    v_who := array(select u from unnest(coalesce(v_ute, '{}')) u where public.olnu_mom_asked(u, v_night) < 2);
    if coalesce(array_length(v_who, 1), 0) >= 2 then
      v_qs := array['first_home', 'last_home', 'bars', 'all_come', 'skal_n'];
      if not exists (select 1 from unnest(coalesce(v_out, '{}')) u where u = any (v_ute)) then v_qs := v_qs || 'first_out'::text; end if;
      v_q := v_qs[1 + (abs(hashtext(p_gid::text || v_night::text)) % array_length(v_qs, 1))];
      v_opts := case when v_q in ('first_home', 'last_home', 'first_out') then public.olnu_mom_faces(p_gid, v_who)
        when v_q = 'bars' then '[{"v":"1"},{"v":"2"},{"v":"3+"}]'::jsonb
        when v_q = 'all_come' then '[{"v":"ja"},{"v":"nej"}]'::jsonb
        else '[{"v":"0_9"},{"v":"10_25"},{"v":"26"}]'::jsonb end;
      insert into public.moment_rounds (group_id, night, kind, q_key, opts, who, meta, created_by, closes_at)
      values (p_gid, v_night, 'vad', v_q, v_opts, v_who, jsonb_build_object('ute', to_jsonb(v_ute)), p_by, public.olnu_mom_at(v_night, 22))
      on conflict (group_id, night, kind, slot) do nothing returning * into r;
      if r.id is not null then
        v_n := v_n + 1;
        perform public.olnu_mom_push(r, v_who, 'olnu-mom-' || r.id, 'Kvällens vad 🎲', public.olnu_mom_qtext(v_q) || ' Stänger 22:00.', p_by);
      end if;
    end if;
  end if;

  -- 2. Halvtid
  if v_hn >= 21 and v_hn < 24.5 and coalesce(array_length(v_out, 1), 0) >= 2
     and not exists (select 1 from public.moment_rounds x where x.group_id = p_gid and x.night = v_night and x.kind = 'halvtid') then
    v_who := array(select u from unnest(v_out) u where public.olnu_mom_asked(u, v_night) < 2);
    if coalesce(array_length(v_who, 1), 0) >= 2 then
      select x.q_key into v_used from public.moment_rounds x where x.group_id = p_gid and x.night = v_night and x.kind = 'vad';
      select count(distinct d.bar_id) into v_bars from public.drink_log d where d.user_id = any (v_mem) and d.night = v_night and d.bar_id is not null and not d.undone and not coalesce(d.ghost, false);
      select count(*) into v_skal from public.skals s join public.beers bb on bb.id = s.beer_id where bb.user_id = any (v_mem) and bb.expires_at = v_night;
      v_qs := array['last_home_t'];
      if v_bars < 3 and v_used is distinct from 'bars' then v_qs := v_qs || 'bars'::text; end if;
      if v_skal < 26 and v_used is distinct from 'skal_n' then v_qs := v_qs || 'skal_n'::text; end if;
      v_q := v_qs[1 + (abs(hashtext(v_night::text || p_gid::text)) % array_length(v_qs, 1))];
      v_opts := case v_q when 'bars' then '[{"v":"1"},{"v":"2"},{"v":"3+"}]'::jsonb when 'skal_n' then '[{"v":"0_9"},{"v":"10_25"},{"v":"26"}]'::jsonb
        else '[{"v":"f01"},{"v":"01_02"},{"v":"e02"}]'::jsonb end;
      insert into public.moment_rounds (group_id, night, kind, q_key, opts, who, created_by, closes_at)
      values (p_gid, v_night, 'halvtid', v_q, v_opts, v_who, p_by, v_now + interval '60 minutes')
      on conflict (group_id, night, kind, slot) do nothing returning * into r;
      if r.id is not null then
        v_n := v_n + 1;
        perform public.olnu_mom_push(r, v_who, 'olnu-mom-' || r.id, 'Halvtid! ⏱️', public.olnu_mom_qtext(v_q) || ' Svara på en minut.', p_by);
      end if;
    end if;
  end if;

  -- 3. Uppdrag vid bordet: 3+ checked in at the same bar right now
  if v_hn >= 18 and v_hn < 25.5
     and (select count(*) from public.moment_rounds x where x.group_id = p_gid and x.night = v_night and x.kind = 'bord') < 2
     and not exists (select 1 from public.moment_rounds x where x.group_id = p_gid and x.night = v_night and x.kind = 'bord' and x.created_at > v_now - interval '60 minutes') then
    select c.bar_id, max(c.bar_name), array_agg(c.user_id) into v_bar, v_barname, v_buids
      from public.checkins c where c.user_id = any (v_mem) and c.expires_at > v_now
     group by c.bar_id having count(*) >= 3 order by count(*) desc limit 1;
    if v_bar is not null then
      v_who := array(select u from unnest(v_buids) u where public.olnu_mom_asked(u, v_night) < 2);
      if coalesce(array_length(v_who, 1), 0) >= 2 then
        insert into public.moment_rounds (group_id, night, kind, slot, who, bar_id, bar_name, mission, created_by, closes_at)
        values (p_gid, v_night, 'bord', 1 + (select count(*) from public.moment_rounds x where x.group_id = p_gid and x.night = v_night and x.kind = 'bord')::int,
                v_who, v_bar, left(v_barname, 40), 1 + (abs(hashtext(p_gid::text || v_bar || v_now::date::text)) % 20), p_by, v_now + interval '45 minutes')
        on conflict (group_id, night, kind, slot) do nothing returning * into r;
        if r.id is not null then
          v_n := v_n + 1;
          perform public.olnu_mom_push(r, v_who, 'olnu-mom-' || r.id, 'Uppdrag vid bordet 🪖',
                                       array_length(v_buids, 1) || ' i plutonen på ' || left(v_barname, 30) || '. Öppna uppdraget.', p_by);
        end if;
      end if;
    end if;
  end if;

  -- 4. Hemlig agent: 3+ within 100 m, not at a bar (presence < 15 min or a live pin that is not at a bar)
  if v_hn >= 17 and v_hn < 22.5 and not exists (select 1 from public.moment_rounds x where x.group_id = p_gid and x.night = v_night and x.kind = 'agent') then
    begin
      with pts as (
        select distinct on (q.u) q.u, q.lat, q.lng from (
          select p.user_id as u, p.lat, p.lng, p.at as t from public.bold_presence p
           where p.user_id = any (v_mem) and p.at > v_now - interval '15 minutes' and p.lat is not null and p.lng is not null
          union all
          select bb.user_id, bb.lat, bb.lng, coalesce(bb.updated_at, bb.created_at) from public.beers bb
           where bb.user_id = any (v_mem) and bb.expires_at > v_now and not coalesce(bb.stopped, false) and bb.snap_bar is null
             and not coalesce(bb.ghost, false) and bb.lat is not null) q
        order by q.u, q.t desc
      ), cl as (
        select a.u, array_agg(o.u) as present from pts a join pts o on public.olnu_dist_m(a.lat, a.lng, o.lat, o.lng) <= 100
         where not exists (select 1 from public.bars_lite bl where bl.lat between a.lat - 0.001 and a.lat + 0.001 and bl.lng between a.lng - 0.002 and a.lng + 0.002
                             and public.olnu_dist_m(a.lat, a.lng, bl.lat, bl.lng) <= 80)
         group by a.u having count(*) >= 3
      )
      select cl.present into v_present from cl order by array_length(cl.present, 1) desc limit 1;
    exception when others then v_present := null;
    end;
    if v_present is not null and public.olnu_mom_agent_start(p_gid, v_night, v_present, null) is not null then v_n := v_n + 1; end if;
  end if;

  -- the vote push at 23:00 (once; the host's early Avslöja sends its own)
  for r in select * from public.moment_rounds x where x.group_id = p_gid and x.night = v_night and x.kind = 'agent'
             and x.revealed_at is null and v_now >= x.reveal_at and v_now < x.closes_at and not (x.meta ? 'vp') loop
    update public.moment_rounds set meta = meta || '{"vp":1}'::jsonb where id = r.id;
    perform public.olnu_mom_push(r, array(select u from unnest(r.who) u where u <> r.agent), 'olnu-mom-v' || r.id, 'Vem ä agenten? 🕵️', 'Rösta nu. 15 minuter.', null);
  end loop;
  return v_n;
end; $$;

-- ---------- one round as the app sees it ----------
create or replace function public.olnu_mom_view(p_id bigint, p_uid uuid, p_full boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r public.moment_rounds; v_now timestamptz := public.olnu_crew_now(); v_mine text; v_closed boolean; v_phase text;
  v_picks jsonb; v_n int; v_names jsonb; v_agent_me boolean; v_show boolean;
begin
  select * into r from public.moment_rounds where id = p_id;
  if not found then return null; end if;
  v_closed := v_now >= r.closes_at or r.answer is not null;
  v_agent_me := r.kind = 'agent' and r.agent = p_uid;
  v_phase := case when r.kind = 'agent' then
      case when r.answer is not null or v_now >= r.closes_at then 'done' when r.revealed_at is not null or v_now >= r.reveal_at then 'vote' else 'secret' end
    when r.kind = 'bord' then case when r.done_at is not null then 'done' when v_now >= r.closes_at then 'expired' else 'open' end
    else case when r.answer is not null then 'settled' when v_closed then 'closed' else 'open' end end;
  select p.pick into v_mine from public.moment_picks p where p.round_id = r.id and p.user_id = p_uid;
  select count(*) into v_n from public.moment_picks p where p.round_id = r.id;
  -- names of the faces in this round (the asked people + the options)
  select coalesce(jsonb_object_agg(public.olnu_crew_k(r.group_id, m.user_id), left(coalesce(m.display_name, ''), 30)), '{}'::jsonb) into v_names
    from public.group_members m where m.group_id = r.group_id and m.user_id = any (r.who);
  -- who picked what: after my own pick (reciprocity) or when closed; agent votes only when the vote is done
  v_show := p_full or (r.kind = 'agent' and v_phase = 'done') or (r.kind in ('vad', 'halvtid') and (v_mine is not null or v_closed));
  if v_show then
    select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_crew_k(r.group_id, p.user_id), 'pick', p.pick,
             'right', r.answer is not null and p.pick = (r.answer ->> 'v')) order by p.at), '[]'::jsonb)
      into v_picks from public.moment_picks p where p.round_id = r.id;
  end if;
  return jsonb_build_object('id', r.id, 'group_id', r.group_id, 'group_name', (select left(g.name, 40) from public.groups g where g.id = r.group_id),
    'kind', r.kind, 'q', r.q_key, 'opts', r.opts, 'names', v_names, 'phase', v_phase, 'closes_at', r.closes_at, 'reveal_at', r.reveal_at,
    'asked', p_uid = any (r.who), 'me', public.olnu_crew_k(r.group_id, p_uid), 'mine', v_mine, 'n_picks', v_n, 'n_who', coalesce(array_length(r.who, 1), 0),
    'picks', v_picks, 'answer', r.answer, 'bar_name', r.bar_name,
    'mission', case when r.kind = 'bord' or v_agent_me or v_phase = 'done' or p_full then r.mission end,
    'agent_me', v_agent_me, 'host_me', r.kind = 'agent' and (r.created_by = p_uid or (r.created_by is null and r.who[1] = p_uid)),
    'agent_k', case when v_phase = 'done' or p_full then public.olnu_crew_k(r.group_id, r.agent) end,
    'done_at', r.done_at, 'done_by', case when r.done_by is not null then (select left(m.display_name, 30) from public.group_members m where m.group_id = r.group_id and m.user_id = r.done_by) end,
    'night', r.night);
end; $$;
-- ---------- RPCs ----------
create or replace function public.moments_poll(p_group_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid(); v_now timestamptz := public.olnu_crew_now(); v_night timestamptz := public.olnu_night_of(v_now);
  g record; v_opened int := 0; v_rounds jsonb; x record;
begin
  if not public.olnu_after_on('moments') then
    return jsonb_build_object('v', 1, 'on', false, 'rounds', '[]'::jsonb);
  end if;
  for g in select m.group_id from public.group_members m
            where m.user_id = v_uid and (p_group_id is null or m.group_id = p_group_id)
              and not exists (select 1 from public.dm_threads t where t.group_id = m.group_id) loop
    v_opened := v_opened + public.olnu_mom_open(g.group_id, v_uid);
  end loop;
  for x in select r.id from public.moment_rounds r where r.night = v_night and v_uid = any (r.who) and r.answer is null and r.kind <> 'bord' loop
    perform public.olnu_mom_settle(x.id);
  end loop;
  select coalesce(jsonb_agg(public.olnu_mom_view(r.id, v_uid) order by r.created_at), '[]'::jsonb) into v_rounds
    from public.moment_rounds r where r.night = v_night and v_uid = any (r.who) and (p_group_id is null or r.group_id = p_group_id);
  return jsonb_build_object('v', 1, 'on', true, 'now', v_now, 'night', v_night, 'opened', v_opened,
    'push_ev', public.olnu_after_on('push_ev'), 'ghost', public.olnu_after_ghost(v_uid, v_night), 'rounds', v_rounds);
end; $$;

create or replace function public.moment_pick(p_round bigint, p_pick text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid(); v_now timestamptz := public.olnu_crew_now(); r public.moment_rounds; v_old public.moment_picks;
  v_pick text := left(coalesce(p_pick, ''), 20); v_voters int; v_votes int;
begin
  perform public.olnu_mom_settle(p_round);
  select * into r from public.moment_rounds where id = p_round for update;
  if not found then raise exception 'not_found'; end if;
  if not (v_uid = any (r.who)) then raise exception 'not_asked'; end if;
  if r.kind = 'bord' then raise exception 'invalid_kind'; end if;
  if r.kind = 'agent' then
    if r.agent = v_uid then raise exception 'is_agent'; end if;
    if not ((r.revealed_at is not null or v_now >= r.reveal_at) and v_now < r.closes_at and r.answer is null) then raise exception 'too_late'; end if;
    if not exists (select 1 from unnest(r.who) u where u <> v_uid and public.olnu_crew_k(r.group_id, u) = v_pick) then raise exception 'invalid_pick'; end if;
  else
    if r.answer is not null or v_now >= r.closes_at then raise exception 'too_late'; end if;
    if not exists (select 1 from jsonb_array_elements(r.opts) o where o ->> 'v' = v_pick) then raise exception 'invalid_pick'; end if;
  end if;
  select * into v_old from public.moment_picks where round_id = r.id and user_id = v_uid;
  if found then
    if v_old.pick = v_pick then return public.olnu_mom_view(r.id, v_uid); end if;
    if v_old.changes >= 1 then raise exception 'no_more_changes'; end if;
    update public.moment_picks set pick = v_pick, changes = changes + 1, at = v_now where round_id = r.id and user_id = v_uid;
  else
    insert into public.moment_picks (round_id, user_id, pick, at) values (r.id, v_uid, v_pick, v_now);
  end if;
  if r.kind = 'agent' then   -- everyone voted = the vote is over
    v_voters := coalesce(array_length(r.who, 1), 1) - 1;
    select count(*) into v_votes from public.moment_picks where round_id = r.id;
    if v_votes >= v_voters then update public.moment_rounds set closes_at = v_now where id = r.id; perform public.olnu_mom_settle(r.id); end if;
  end if;
  return public.olnu_mom_view(r.id, v_uid);
end; $$;

create or replace function public.moment_done(p_round bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_now timestamptz := public.olnu_crew_now(); r public.moment_rounds;
begin
  select * into r from public.moment_rounds where id = p_round for update;
  if not found then raise exception 'not_found'; end if;
  if r.kind = 'bord' then
    if not (v_uid = any (r.who)) then raise exception 'not_asked'; end if;
    if r.done_at is null then
      if v_now >= r.closes_at then raise exception 'too_late'; end if;
      update public.moment_rounds set done_at = v_now, done_by = v_uid where id = r.id;
    end if;
  elsif r.kind = 'agent' then
    if r.agent is distinct from v_uid then raise exception 'not_agent'; end if;
    if r.done_at is null then
      if v_now >= r.closes_at then raise exception 'too_late'; end if;
      update public.moment_rounds set done_at = v_now, done_by = v_uid where id = r.id;
    end if;
  else raise exception 'invalid_kind';
  end if;
  return public.olnu_mom_view(r.id, v_uid);
end; $$;

create or replace function public.moment_reveal(p_round bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_now timestamptz := public.olnu_crew_now(); r public.moment_rounds;
begin
  select * into r from public.moment_rounds where id = p_round for update;
  if not found or r.kind <> 'agent' then raise exception 'not_found'; end if;
  if not (r.created_by = v_uid or (r.created_by is null and r.who[1] = v_uid)) then raise exception 'not_host'; end if;
  if r.revealed_at is null and v_now < r.reveal_at then
    update public.moment_rounds set revealed_at = v_now, closes_at = v_now + interval '15 minutes', meta = meta || '{"vp":1}'::jsonb where id = r.id
      returning * into r;
    perform public.olnu_mom_push(r, array(select u from unnest(r.who) u where u <> r.agent), 'olnu-mom-v' || r.id, 'Vem ä agenten? 🕵️', 'Rösta nu. 15 minuter.', v_uid);
  end if;
  return public.olnu_mom_view(r.id, v_uid);
end; $$;

-- Förfest started on one phone with these group members ticked (names as the group shows them). 3+ = an agent round.
create or replace function public.moment_home_party(p_group_id uuid, p_names text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_night timestamptz := public.olnu_night_of(public.olnu_crew_now()); v_present uuid[]; v_id bigint;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if not public.olnu_after_on('moments') then return jsonb_build_object('ok', false, 'why', 'off'); end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_mom:' || p_group_id::text || ':' || v_night::text, 0));
  v_present := array(select distinct m.user_id from public.group_members m
                      where m.group_id = p_group_id and (m.user_id = v_uid or lower(trim(m.display_name)) = any (
                        select lower(trim(n)) from unnest(coalesce(p_names, '{}')) n limit 30)));
  if coalesce(array_length(v_present, 1), 0) < 3 then return jsonb_build_object('ok', false, 'why', 'not_enough'); end if;
  v_id := public.olnu_mom_agent_start(p_group_id, v_night, v_present, v_uid);
  if v_id is null then return jsonb_build_object('ok', false, 'why', 'not_now'); end if;
  return jsonb_build_object('ok', true, 'round', public.olnu_mom_view(v_id, v_uid));
end; $$;

-- The night's moments for the morning report (members only; everything shown, results settled where possible).
create or replace function public.moments_report(p_group_id uuid, p_night timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_night timestamptz; x record; v jsonb;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  v_night := case when p_night is null then public.olnu_night_of(public.olnu_crew_now() - interval '24 hours') else public.olnu_night_of(p_night - interval '1 second') end;
  for x in select r.id from public.moment_rounds r where r.group_id = p_group_id and r.night = v_night and r.answer is null and r.kind <> 'bord' loop
    perform public.olnu_mom_settle(x.id);
  end loop;
  select coalesce(jsonb_agg(public.olnu_mom_view(r.id, v_uid, true) order by r.created_at), '[]'::jsonb) into v
    from public.moment_rounds r where r.group_id = p_group_id and r.night = v_night;
  return jsonb_build_object('v', 1, 'night', v_night, 'rounds', v);
end; $$;

do $g$
declare f text;
begin
  foreach f in array array['olnu_mom_hn(timestamptz)', 'olnu_mom_at(timestamptz,numeric)', 'olnu_mom_asked(uuid,timestamptz)', 'olnu_mom_qtext(text)',
    'olnu_mom_uid(uuid,text)', 'olnu_mom_faces(uuid,uuid[])', 'olnu_mom_push(public.moment_rounds,uuid[],text,text,text,uuid)', 'olnu_mom_answer(bigint)',
    'olnu_mom_settle(bigint)', 'olnu_mom_agent_start(uuid,timestamptz,uuid[],uuid)', 'olnu_mom_open(uuid,uuid)', 'olnu_mom_view(bigint,uuid,boolean)',
    'olnu_mom_hn(timestamptz)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array['moments_poll(uuid)', 'moment_pick(bigint,text)', 'moment_done(bigint)', 'moment_reveal(bigint)',
    'moment_home_party(uuid,text[])', 'moments_report(uuid,timestamptz)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated, service_role';
  end loop;
end $g$;
