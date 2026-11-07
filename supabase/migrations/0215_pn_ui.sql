-- PintsNow UI update (agent ui-build, 2026-11-07). Additive only: 2 new tables, 6 new RPCs. No old table, RPC or
-- policy changes, so the live app sees nothing new until the new client calls these.
--   1. 🍺 "Ikväll?" status (Ute / Kanske / Hemma) from 16:00 to 05:00, seen by friends and group mates.
--        ikvall_set(p_st)                 'ute' | 'kanske' | 'hemma' | null (clear)  → {ok, st}
--        ikvall_status(p_group_id)        → {v, mine, counts {ute,kanske,hemma}, people [{name, st, friend}]}
--   2. 📊 Krogmätaren "vanligt" level: bar_norm(p_bar_ids) → {v, bars {id: {usual, nights}}}. Real data only
--      (drink_log, no test users). A bar with fewer than 3 nights of data in the last 8 same weekdays has no entry.
--   3. 💡 Önska / 🐞 Rapportera fel / ☀️ morning question: submit_feedback(p_kind, p_text, p_answer, p_meta)
--      → {ok, id}; owner_feedback(p_key) for stats.html. Separate table (feature_wishes / top_wishes are untouched).

-- ---------- 1. Ikväll? ----------
create table if not exists public.ikvall_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  night timestamptz not null,
  st text not null check (st in ('ute', 'kanske', 'hemma')),
  updated_at timestamptz not null default now()
);
alter table public.ikvall_status enable row level security;
revoke all on table public.ikvall_status from public, anon, authenticated;

create or replace function public.ikvall_set(p_st text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_st text := nullif(lower(trim(coalesce(p_st, ''))), '');
begin
  if v_uid is null then raise exception 'not_authed'; end if;
  if v_st is not null and v_st not in ('ute', 'kanske', 'hemma') then raise exception 'invalid_status'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_ikv:' || v_uid::text, 0));
  if exists (select 1 from public.ikvall_status s where s.user_id = v_uid and s.updated_at > now() - interval '1 second') then
    raise exception 'slow_down';
  end if;
  if v_st is null then
    delete from public.ikvall_status s where s.user_id = v_uid;
  else
    insert into public.ikvall_status (user_id, night, st, updated_at) values (v_uid, public.olnu_night_of(now()), v_st, now())
    on conflict (user_id) do update set night = excluded.night, st = excluded.st, updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'st', v_st);
end; $$;

-- Who may see my status: accepted friends and members of a shared group. Only tonight's rows count.
create or replace function public.ikvall_status(p_group_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_people jsonb;
begin
  if v_uid is null then raise exception 'not_authed'; end if;
  if p_group_id is not null and not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  with circle as (
    select m2.user_id as uid, min(m2.display_name) as nm, false as friend
      from public.group_members m1 join public.group_members m2 on m2.group_id = m1.group_id
     where m1.user_id = v_uid and m2.user_id <> v_uid and (p_group_id is null or m1.group_id = p_group_id)
     group by m2.user_id
    union all
    select public.olnu_friend_other(f, v_uid), public.olnu_friend_name(public.olnu_friend_other(f, v_uid)), true
      from public.friendships f
     where p_group_id is null and (f.a = v_uid or f.b = v_uid) and f.status = 'accepted'
  ), ppl as (
    select c.uid, max(c.nm) as nm, bool_or(c.friend) as friend from circle c group by c.uid
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(p.nm, 'Någon'), 'st', s.st, 'friend', p.friend, 'at', s.updated_at)
           order by case s.st when 'ute' then 0 when 'kanske' then 1 else 2 end, s.updated_at desc), '[]'::jsonb)
    into v_people
    from ppl p join public.ikvall_status s on s.user_id = p.uid and s.night = v_night
   limit 80;
  return jsonb_build_object('v', 1, 'night', v_night,
    'mine', (select s.st from public.ikvall_status s where s.user_id = v_uid and s.night = v_night),
    'counts', jsonb_build_object(
      'ute', (select count(*) from jsonb_array_elements(v_people) x where x->>'st' = 'ute'),
      'kanske', (select count(*) from jsonb_array_elements(v_people) x where x->>'st' = 'kanske'),
      'hemma', (select count(*) from jsonb_array_elements(v_people) x where x->>'st' = 'hemma')),
    'people', v_people);
end; $$;

-- ---------- 2. Krogmätaren: the usual crowd at this bar at this time ----------
-- usual = average number of different real users who had logged a drink at the bar by this time of the night,
-- over the last 8 nights on the same weekday (nights without anyone count as 0).
create or replace function public.bar_norm(p_bar_ids text[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_night timestamptz := public.olnu_night_of(now());
  v_into interval := now() - (v_night - interval '24 hours');   -- time since the night began (05:00)
  v_out jsonb;
begin
  if public.olnu_uid() is null then raise exception 'not_authed'; end if;
  if p_bar_ids is null or cardinality(p_bar_ids) = 0 then return jsonb_build_object('v', 1, 'bars', '{}'::jsonb); end if;
  with ids as (select distinct x as bar_id from unnest(p_bar_ids[1:40]) x where x is not null and char_length(x) <= 80),
  nights as (select ((v_night at time zone 'Europe/Stockholm') - (i * interval '7 days')) at time zone 'Europe/Stockholm' as night
               from generate_series(1, 8) i),
  per as (
    select d.bar_id, n.night, count(distinct d.user_id) as users
      from nights n join public.drink_log d on d.night = n.night
      join ids on ids.bar_id = d.bar_id
     where not coalesce(d.undone, false) and not coalesce(d.ghost, false)
       and d.at <= n.night - interval '24 hours' + v_into
       and not public.olnu_is_test_user(d.user_id)
     group by d.bar_id, n.night
  )
  select coalesce(jsonb_object_agg(a.bar_id, jsonb_build_object('usual', a.usual, 'nights', a.nights)), '{}'::jsonb)
    into v_out
    from (select p.bar_id, round(sum(p.users)::numeric / 8, 1) as usual, count(*) as nights
            from per p group by p.bar_id having count(*) >= 3) a;
  return jsonb_build_object('v', 1, 'bars', coalesce(v_out, '{}'::jsonb));
end; $$;

-- ---------- 3. Feedback ----------
create table if not exists public.app_feedback (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('wish', 'bug', 'morning')),
  body text,
  answer text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  status text not null default 'ny' check (status in ('ny', 'läst', 'fixad', 'dold'))
);
create index if not exists app_feedback_created on public.app_feedback (created_at desc);
alter table public.app_feedback enable row level security;
revoke all on table public.app_feedback from public, anon, authenticated;
revoke all on sequence public.app_feedback_id_seq from public, anon, authenticated;

create or replace function public.submit_feedback(p_kind text, p_text text default null, p_answer text default null, p_meta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_kind text := lower(coalesce(p_kind, ''));
  v_body text := nullif(left(regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]', ' ', 'g'), 1000), '');
  v_ans text := nullif(left(lower(coalesce(p_answer, '')), 40), '');
  v_meta jsonb := '{}'::jsonb;
  v_id bigint;
begin
  if v_uid is null then raise exception 'not_authed'; end if;
  if v_kind not in ('wish', 'bug', 'morning') then raise exception 'invalid_kind'; end if;
  if v_kind = 'morning' and (v_ans is null or v_ans !~ '^[a-z_]{2,40}$') then raise exception 'invalid_answer'; end if;
  if v_kind <> 'morning' and (v_body is null or char_length(trim(v_body)) < 3) then raise exception 'too_short'; end if;
  -- meta: only a few short known keys (version, device, screen, error), text only.
  if jsonb_typeof(p_meta) = 'object' then
    select coalesce(jsonb_object_agg(k, left(p_meta->>k, 300)), '{}'::jsonb) into v_meta
      from unnest(array['v', 'ua', 'screen', 'err', 'w', 'h', 'standalone']) k where p_meta ? k;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_fb:' || v_uid::text, 0));
  if exists (select 1 from public.app_feedback f where f.user_id = v_uid and f.created_at > now() - interval '10 seconds')
     or (select count(*) from public.app_feedback f where f.user_id = v_uid and f.created_at > now() - interval '1 day') >= 10 then
    raise exception 'slow_down';
  end if;
  if v_kind = 'morning' and exists (select 1 from public.app_feedback f where f.user_id = v_uid and f.kind = 'morning'
       and f.created_at > now() - interval '20 hours') then
    raise exception 'slow_down';
  end if;
  insert into public.app_feedback (user_id, kind, body, answer, meta) values (v_uid, v_kind, v_body, v_ans, v_meta) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;

create or replace function public.owner_feedback(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'counts', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select f.kind, count(*) n from public.app_feedback f
                where not public.olnu_is_test_user(f.user_id) group by 1) x),
    'morning', (select coalesce(jsonb_object_agg(answer, n), '{}'::jsonb) from (select f.answer, count(*) n from public.app_feedback f
                where f.kind = 'morning' and not public.olnu_is_test_user(f.user_id) and f.created_at > now() - interval '30 days' group by 1) x),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'body', f.body, 'answer', f.answer, 'meta', f.meta,
               'status', f.status, 'created_at', f.created_at, 'test', public.olnu_is_test_user(f.user_id)) order by f.id desc)
              from (select * from public.app_feedback x where x.status <> 'dold' order by x.id desc limit 300) f), '[]'::jsonb),
    'ikvall', (select jsonb_build_object('tonight', count(*) filter (where s.night = public.olnu_night_of(now())),
                'ute', count(*) filter (where s.night = public.olnu_night_of(now()) and s.st = 'ute')) from public.ikvall_status s));
end; $$;

create or replace function public.owner_set_feedback(p_key text, p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if p_status not in ('ny', 'läst', 'fixad', 'dold') then raise exception 'invalid_status'; end if;
  update public.app_feedback f set status = p_status where f.id = p_id;
  return jsonb_build_object('ok', found);
end; $$;

revoke all on function public.ikvall_set(text) from public, anon;
revoke all on function public.ikvall_status(uuid) from public, anon;
revoke all on function public.bar_norm(text[]) from public, anon;
revoke all on function public.submit_feedback(text, text, text, jsonb) from public, anon;
grant execute on function public.ikvall_set(text) to authenticated;
grant execute on function public.ikvall_status(uuid) to authenticated;
grant execute on function public.bar_norm(text[]) to authenticated;
grant execute on function public.submit_feedback(text, text, text, jsonb) to authenticated;
grant execute on function public.owner_feedback(text) to anon, authenticated;
grant execute on function public.owner_set_feedback(text, bigint, text) to anon, authenticated;
