-- 0345 tx01 RANKS v3 (OWNER-RUN on release day, when the big-update client is live).
-- 1. olnu_titles(): the owner-approved names (v2) and rebalanced thresholds (v3, from live meriter_log data 2026-11-08).
--    Same function name, arguments and return type, so every caller (olnu_rank_of, my_meriter, my_stats, poll_v2,
--    meriter_board, group_status) keeps working. Every new threshold is <= the old one at the same step, so no rank goes
--    down. The new client names ranks from its own ladder (docs/js/social.js, ladder version 15 = one quiet
--    "Armén har fått nya grader!" toast), so the release order does not matter.
-- 2. olnu_mer_add(): ONE RANK PER ACTION. All meriter written in one transaction (one action: a beer tap + squad, a duel
--    end, a bulk count change) can lift the user at most one rank. Points that would cross a second threshold are NOT
--    lost: they wait in meriter_carry and are paid out (kind 'carry') at the start of the next action, again only up to
--    one rank. Live data: 85 of 735 past actions (mostly beer + squad = 15) would have crossed two of the new low
--    thresholds without this rule. Same name, arguments and return type. New: table meriter_carry (RLS on, no client
--    access), kind 'carry' in meriter_log (client toast line in js/meriter.js).
-- Undo = run the 0036 olnu_titles() body and the 0036 olnu_mer_add() body again (meriter_carry then stays unused).
-- Safe to run again. meriter_carry has no foreign key to auth.users (this file may not hold row-removing words):
-- the account-removal function should also clear meriter_carry for the user (owner/cleanup agent, one line).
-- No row-removing or object-removing statement in this file.
create or replace function public.olnu_titles()
returns table(at integer, title text)
language sql immutable set search_path = public as $$
  select * from (values
    (0, 'Rekryt Lättöl'), (4, 'Värnpliktig Veteöl'), (8, 'Menig Mellanöl'), (13, 'Vicekorpral Kapsyl'),
    (19, 'Korpral Kranöl'), (26, 'Skumsergeant'), (34, 'Översergeant Sejdel'), (43, 'Stabssergeant Sixpack'),
    (53, 'Fanjunkare Flaskhals'), (65, 'Förvaltare Folköl'), (79, 'Fänrik Fatöl'), (95, 'Löjtnant Lager'),
    (115, 'Premiärlöjtnant Pilsner'), (135, 'Kapten Kagge'), (155, 'Stabskapten Stout'), (180, 'Major Mikrobryggeri'),
    (210, 'Överstelöjtnant Ölback'), (245, 'Överste Stor Stark'), (280, 'Brigadgeneral Burköl'), (320, 'Generalmajor Mörköl'),
    (365, 'Generallöjtnant IPA'), (410, 'General Guldbärs'), (465, 'Överbefälhavare Öl'), (520, 'Fältmarskalk Humle'),
    (585, 'Riksmarskalk Malt'), (655, 'Generalissimus Ale'), (725, 'Ärkegeneral Ölhall'), (805, 'Supergeneral Pint'),
    (895, 'Krigsherre Porter'), (985, 'Kommendant Julöl'), (1085, 'Imperator Påsköl'), (1190, 'Stormarskalk Ölstop'),
    (1300, 'Kejsargeneral Ölmage'), (1420, 'Fältherre Öltält'), (1545, 'General Oktoberfest'), (1680, 'Supermarskalk Pubrunda'),
    (1820, 'Överkommendant Ölglas'), (1970, 'Ärkemarskalk Ölbricka'), (2130, 'Krigsgud Hembrygd'), (2295, 'Ölgudens Överste'),
    (2470, 'Ölgudens Livgarde'), (2650, 'Ölguden')
  ) as t(at, title);
$$;

create table if not exists public.meriter_carry (
  user_id    uuid primary key,   -- no foreign key on purpose (see the note at the top)
  pts        integer not null default 0 check (pts >= 0),
  updated_at timestamptz not null default now()
);
alter table public.meriter_carry enable row level security;
revoke all on table public.meriter_carry from public, anon, authenticated;

create or replace function public.olnu_mer_add(p_uid uuid, p_night timestamp with time zone, p_kind text, p_ref text,
                                               p_pts integer, p_cap integer default null::integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_used  int;
  v_pts   int := p_pts;
  v_got   int;
  v_key   text;
  v_base  int;
  v_cur   int;
  v_next  int;
  v_next2 int := null;
  v_carry int;
  v_rel   int;
begin
  if p_uid is null or p_night is null or p_kind is null or coalesce(p_pts, 0) <= 0 then
    return 0;
  end if;
  if p_kind = 'drink' then v_pts := 5; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-mer:' || p_uid::text, 0));
  if exists (select 1 from public.meriter_log l
              where l.user_id = p_uid and l.night = p_night and l.kind = p_kind and l.ref = coalesce(p_ref, '')) then
    return 0;   -- 0345: already given (same rule as the old "on conflict do nothing"); checked first so nothing is carried
  end if;
  if p_cap is not null then
    select coalesce(sum(l.pts), 0)::int into v_used
      from public.meriter_log l where l.user_id = p_uid and l.night = p_night and l.kind = p_kind;
    if v_used >= p_cap then return 0; end if;
    v_pts := least(v_pts, p_cap - v_used);
  end if;
  -- 0345: one rank per action. v_base = the total when this transaction first gave the user meriter.
  v_key := 'olnu.merbase_' || replace(p_uid::text, '-', '');
  v_base := nullif(current_setting(v_key, true), '')::int;
  if v_base is null then
    v_base := public.olnu_meriter(p_uid);
    perform set_config(v_key, v_base::text, true);
    select r.next_at into v_next from public.olnu_rank_of(v_base) r;
    if v_next is not null then select r.next_at into v_next2 from public.olnu_rank_of(v_next) r; end if;
    -- first award of a new action: pay out what an earlier action could not give (up to the same one-rank limit)
    select c.pts into v_carry from public.meriter_carry c where c.user_id = p_uid for update;
    if coalesce(v_carry, 0) > 0 then
      v_rel := case when v_next2 is null then v_carry else least(v_carry, v_next2 - 1 - v_base) end;
      if v_rel > 0 then
        insert into public.meriter_log (user_id, night, kind, ref, pts)
        values (p_uid, p_night, 'carry', 'c' || txid_current()::text, v_rel)
        on conflict (user_id, night, kind, ref) do nothing;
        update public.meriter_carry set pts = pts - v_rel, updated_at = now() where user_id = p_uid;
      end if;
    end if;
  else
    select r.next_at into v_next from public.olnu_rank_of(v_base) r;
    if v_next is not null then select r.next_at into v_next2 from public.olnu_rank_of(v_next) r; end if;
  end if;
  if v_next2 is not null then
    v_cur := public.olnu_meriter(p_uid);
    if v_pts > v_next2 - 1 - v_cur then
      insert into public.meriter_carry as mc (user_id, pts) values (p_uid, v_pts - greatest(0, v_next2 - 1 - v_cur))
      on conflict (user_id) do update set pts = mc.pts + excluded.pts, updated_at = now();
      v_pts := greatest(0, v_next2 - 1 - v_cur);
    end if;
    if v_pts <= 0 then return 0; end if;
  end if;
  insert into public.meriter_log (user_id, night, kind, ref, pts)
  values (p_uid, p_night, p_kind, coalesce(p_ref, ''), v_pts)
  on conflict (user_id, night, kind, ref) do nothing
  returning pts into v_got;
  return coalesce(v_got, 0);
end; $function$;
