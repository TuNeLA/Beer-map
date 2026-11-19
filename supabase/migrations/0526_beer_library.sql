-- 0526 · Beer library (I-132, lane beerui): favourites (max 3), ratings 1–5, short reviews with reports. OWNER-RUN via the
-- coordinator (RULES §5). Staging first. NOT run by the lane.
-- Check after the run (expect t, t, t, t, t, t, t):
--   select to_regclass('public.beer_favourites') is not null, to_regclass('public.beer_ratings') is not null,
--     to_regclass('public.beer_reviews') is not null, to_regclass('public.beer_review_reports') is not null,
--     not has_function_privilege('anon', 'public.beerlib_beer_get(text)', 'execute'),
--     not has_function_privilege('anon', 'public.beerlib_fav_set(integer, text)', 'execute'),
--     has_function_privilege('authenticated', 'public.beerlib_beer_get(text)', 'execute');
--
-- Why: the owner wants a beer library in the app (I-132): "choose 1 or 2 or 3 beers that are your favorites ... rate them from
-- 1 to 5 ... review". The beer and style data are static app files (docs/data/beer/, Open Food Facts + our own texts), so a beer
-- id here is the app's beer id (an Open Food Facts barcode, text). No beer table on the server.
-- Owner defaults (OWNER-INPUTS): A25 strangers see a reviewer's first name only, no picture (friends and group mates see the name);
--   A26 a review is hidden after 3 reports from different people and waits for the owner; A27 the average shows only from 5 ratings.
-- What it adds (all new; nothing existing is changed):
--   Tables (RLS on, no policy, no grant: only the functions below read or write them):
--     beer_favourites (user_id, slot 1..3, beer_id or null)   max 3 by the key; one beer once per person
--     beer_prefs (user_id, fav_mode alla|vanner|spoke)         who may see my favourites (the app sends its Synlighet mode)
--     beer_ratings (user_id, beer_id, stars 1..5 or null)      one rating per person and beer; null = no rating
--     beer_reviews (id, beer_id, user_id, body <= 280, stars, status live|hidden|removed, report_count, times)
--     beer_review_reports (review_id, reporter_id, reason spam|rude|wrong|other, note)   one per reporter and review
--   RPCs (security definer, fixed search_path, auth.uid() in the body, execute for authenticated only):
--     beerlib_favs_mine() · beerlib_fav_set(slot, beer) · beerlib_privacy(mode) · beerlib_favs_for(key | group + k)
--     beerlib_rate(beer, stars) · beerlib_beer_get(beer) · beerlib_review_post(beer, body, stars) · beerlib_review_remove(id)
--     beerlib_review_report(id, reason, note)
--   Helpers (internal, no grant): olnu_bl_id_ok(text), olnu_bl_stats(text), olnu_bl_name(uuid, uuid)
-- Limits: 20 reviews and 10 reports per person per day (slow_down). No links or phone numbers in a review (bad_text).
-- Never: "beers tried" counts, per-person rating totals, top lists. The average is information only.
-- Owner review queue (SQL editor):  select id, beer_id, body, report_count, created_at from public.beer_reviews where status = 'hidden' order by created_at;
--   keep:  update public.beer_reviews set status = 'live', report_count = 0 where id = <id>;   take off: ... set status = 'removed' ...
-- Personal data: every table has a user uuid column (user_id / reporter_id), so the erase function re-keys it like the others.
-- Additive. Safe to run twice. CR LF safe. Needs: olnu_inv_cands, olnu_chief_k, olnu_dm_friends, olnu_dm_blocked, olnu_are_friends,
--   olnu_friend_name (0045, 0137, 0470), olnu_strip_cr (0436).

create table if not exists public.beer_favourites (
  user_id    uuid not null,
  slot       smallint not null check (slot between 1 and 3),
  beer_id    text null check (beer_id is null or beer_id ~ '^[0-9A-Za-z_-]{1,40}$'),
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);
create unique index if not exists beer_favourites_one on public.beer_favourites (user_id, beer_id) where beer_id is not null;
alter table public.beer_favourites enable row level security;
revoke all on table public.beer_favourites from public, anon, authenticated;

create table if not exists public.beer_prefs (
  user_id    uuid primary key,
  fav_mode   text not null default 'alla' check (fav_mode in ('alla', 'vanner', 'spoke')),
  updated_at timestamptz not null default now()
);
alter table public.beer_prefs enable row level security;
revoke all on table public.beer_prefs from public, anon, authenticated;

create table if not exists public.beer_ratings (
  user_id    uuid not null,
  beer_id    text not null check (beer_id ~ '^[0-9A-Za-z_-]{1,40}$'),
  stars      smallint null check (stars is null or stars between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (user_id, beer_id)
);
create index if not exists beer_ratings_beer on public.beer_ratings (beer_id) where stars is not null;
alter table public.beer_ratings enable row level security;
revoke all on table public.beer_ratings from public, anon, authenticated;

create table if not exists public.beer_reviews (
  id           bigserial primary key,
  beer_id      text not null check (beer_id ~ '^[0-9A-Za-z_-]{1,40}$'),
  user_id      uuid not null,
  body         text not null check (char_length(body) between 2 and 280),
  stars        smallint null check (stars is null or stars between 1 and 5),
  status       text not null default 'live' check (status in ('live', 'hidden', 'removed')),
  report_count integer not null default 0,
  created_at   timestamptz not null default now(),
  edited_at    timestamptz null
);
create unique index if not exists beer_reviews_one on public.beer_reviews (user_id, beer_id) where status <> 'removed';
create index if not exists beer_reviews_beer on public.beer_reviews (beer_id, created_at desc);
create index if not exists beer_reviews_user_day on public.beer_reviews (user_id, created_at);
alter table public.beer_reviews enable row level security;
revoke all on table public.beer_reviews from public, anon, authenticated;

create table if not exists public.beer_review_reports (
  review_id   bigint not null references public.beer_reviews (id),
  reporter_id uuid not null,
  reason      text not null check (reason in ('spam', 'rude', 'wrong', 'other')),
  note        text null check (note is null or char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  primary key (review_id, reporter_id)
);
create index if not exists beer_review_reports_day on public.beer_review_reports (reporter_id, created_at);
alter table public.beer_review_reports enable row level security;
revoke all on table public.beer_review_reports from public, anon, authenticated;
revoke all on sequence public.beer_reviews_id_seq from public, anon, authenticated;

-- ---------- helpers (internal) ----------
create or replace function public.olnu_bl_id_ok(p text)
returns boolean language sql immutable set search_path = public as $$
  select p is not null and p ~ '^[0-9A-Za-z_-]{1,40}$';
$$;
revoke all on function public.olnu_bl_id_ok(text) from public, anon, authenticated;

-- count + average of the ratings of one beer; the average only from 5 ratings (A27)
create or replace function public.olnu_bl_stats(p_beer text)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('n', count(*), 'avg', case when count(*) >= 5 then round(avg(r.stars)::numeric, 1) end)
    from public.beer_ratings r where r.beer_id = p_beer and r.stars is not null;
$$;
revoke all on function public.olnu_bl_stats(text) from public, anon, authenticated;

-- how p_viewer sees p_writer's name (A25): friends and group mates the name; others the first word only; no picture for anyone here
create or replace function public.olnu_bl_name(p_viewer uuid, p_writer uuid)
returns jsonb language sql stable set search_path = public as $$
  select case
    when p_viewer = p_writer then jsonb_build_object('name', public.olnu_friend_name(p_writer), 'known', true)
    when public.olnu_dm_friends(p_viewer, p_writer) then jsonb_build_object('name', public.olnu_friend_name(p_writer), 'known', true)
    else jsonb_build_object('name', nullif(split_part(btrim(coalesce(public.olnu_friend_name(p_writer), '')), ' ', 1), ''), 'known', false)
  end;
$$;
revoke all on function public.olnu_bl_name(uuid, uuid) from public, anon, authenticated;

-- ---------- favourites ----------
create or replace function public.beerlib_favs_mine()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('slot', f.slot, 'beer', f.beer_id) order by f.slot)
                     from public.beer_favourites f where f.user_id = v_uid and f.beer_id is not null), '[]'::jsonb);
end $$;

-- p_beer null = that slot is empty. A beer that sits in another slot moves here (never twice).
create or replace function public.beerlib_fav_set(p_slot integer, p_beer text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_slot is null or p_slot < 1 or p_slot > 3 then raise exception 'invalid_slot'; end if;
  if p_beer is not null and not public.olnu_bl_id_ok(p_beer) then raise exception 'invalid_beer'; end if;
  if p_beer is not null then
    update public.beer_favourites set beer_id = null, updated_at = now()
     where user_id = v_uid and beer_id = p_beer and slot <> p_slot;
  end if;
  insert into public.beer_favourites (user_id, slot, beer_id, updated_at) values (v_uid, p_slot, p_beer, now())
  on conflict (user_id, slot) do update set beer_id = excluded.beer_id, updated_at = now();
  return public.beerlib_favs_mine();
end $$;

create or replace function public.beerlib_privacy(p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_mode is null or p_mode not in ('alla', 'vanner', 'spoke') then raise exception 'invalid_mode'; end if;
  insert into public.beer_prefs (user_id, fav_mode, updated_at) values (v_uid, p_mode, now())
  on conflict (user_id) do update set fav_mode = excluded.fav_mode, updated_at = now();
  return jsonb_build_object('mode', p_mode);
end $$;

-- Another person's favourites: only a friend or a group mate (like dm_open), never across a block, and only by that person's
-- mode: spoke = nobody; vanner = friends only; alla (default) = friends and group mates. Strangers never.
create or replace function public.beerlib_favs_for(p_key text default null, p_group_id uuid default null, p_k text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_o uuid;
  v_mode text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if nullif(btrim(coalesce(p_key, '')), '') is not null then
    select c.uid into v_o from public.olnu_inv_cands(v_uid) c where c.k = btrim(p_key) limit 1;
  elsif p_group_id is not null and nullif(btrim(coalesce(p_k, '')), '') is not null then
    if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
      raise exception 'not_member';
    end if;
    select m.user_id into v_o from public.group_members m
     where m.group_id = p_group_id and public.olnu_chief_k(p_group_id, m.user_id) = btrim(p_k) limit 1;
  end if;
  if v_o is null or v_o = v_uid then raise exception 'invalid_target'; end if;
  if not public.olnu_dm_friends(v_uid, v_o) or public.olnu_dm_blocked(v_uid, v_o) then return '[]'::jsonb; end if;
  v_mode := coalesce((select p.fav_mode from public.beer_prefs p where p.user_id = v_o), 'alla');
  if v_mode = 'spoke' or (v_mode = 'vanner' and not public.olnu_are_friends(v_uid, v_o)) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('slot', f.slot, 'beer', f.beer_id) order by f.slot)
                     from public.beer_favourites f where f.user_id = v_o and f.beer_id is not null), '[]'::jsonb);
end $$;

-- ---------- ratings ----------
-- p_stars null = take my rating back. Answer: my stars + count (+ average from 5 ratings).
create or replace function public.beerlib_rate(p_beer text, p_stars integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_bl_id_ok(p_beer) then raise exception 'invalid_beer'; end if;
  if p_stars is not null and (p_stars < 1 or p_stars > 5) then raise exception 'invalid_stars'; end if;
  insert into public.beer_ratings (user_id, beer_id, stars, updated_at) values (v_uid, p_beer, p_stars, now())
  on conflict (user_id, beer_id) do update set stars = excluded.stars, updated_at = now();
  return jsonb_build_object('stars', p_stars) || public.olnu_bl_stats(p_beer);
end $$;

-- ---------- the beer page: my rating, my favourite slot, the count / average, the reviews I may see ----------
create or replace function public.beerlib_beer_get(p_beer text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_bl_id_ok(p_beer) then raise exception 'invalid_beer'; end if;
  return jsonb_build_object(
    'my_stars', (select r.stars from public.beer_ratings r where r.user_id = v_uid and r.beer_id = p_beer),
    'fav_slot', (select f.slot from public.beer_favourites f where f.user_id = v_uid and f.beer_id = p_beer),
    'reviews', coalesce((select jsonb_agg(x.j order by x.mine desc, x.created_at desc) from (
        select v.created_at, (v.user_id = v_uid) as mine,
               jsonb_build_object('id', v.id, 'body', v.body, 'stars', v.stars, 'at', v.created_at, 'status', v.status, 'mine', v.user_id = v_uid)
                 || public.olnu_bl_name(v_uid, v.user_id) as j
          from public.beer_reviews v
         where v.beer_id = p_beer
           and (v.status = 'live' or (v.status = 'hidden' and v.user_id = v_uid))
           and (v.user_id = v_uid or not public.olnu_dm_blocked(v_uid, v.user_id))
         order by (v.user_id = v_uid) desc, v.created_at desc
         limit 50) x), '[]'::jsonb)
  ) || public.olnu_bl_stats(p_beer);
end $$;

-- ---------- reviews ----------
-- One live review per person and beer: a second post edits it (a hidden one stays hidden until the owner has checked it).
create or replace function public.beerlib_review_post(p_beer text, p_body text, p_stars integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '[[:cntrl:][:space:]]+', ' ', 'g'));
  v_id bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_bl_id_ok(p_beer) then raise exception 'invalid_beer'; end if;
  if char_length(v_body) < 2 or char_length(v_body) > 280 then raise exception 'invalid_body'; end if;
  if p_stars is not null and (p_stars < 1 or p_stars > 5) then raise exception 'invalid_stars'; end if;
  if v_body ~* '(https?://|www\.|\.(se|com|nu|net|org)([^a-z]|$))' or v_body ~ '([0-9][ -]?){8,}' then raise exception 'bad_text'; end if;
  if (select count(*) from public.beer_reviews v where v.user_id = v_uid and v.created_at > now() - interval '1 day') >= 20 then
    raise exception 'slow_down';
  end if;
  update public.beer_reviews set body = v_body, stars = p_stars, edited_at = now()
   where user_id = v_uid and beer_id = p_beer and status <> 'removed'
  returning id into v_id;
  if v_id is null then
    insert into public.beer_reviews (beer_id, user_id, body, stars) values (p_beer, v_uid, v_body, p_stars) returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- the writer takes the own review off (soft: status removed)
create or replace function public.beerlib_review_remove(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_n integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.beer_reviews set status = 'removed', edited_at = now() where id = p_id and user_id = v_uid and status <> 'removed';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0);
end $$;

-- 3 reports from different people hide a review (A26). Not one's own review. 10 reports per person per day.
create or replace function public.beerlib_review_report(p_id bigint, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_n integer;
  v_status text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_reason is null or p_reason not in ('spam', 'rude', 'wrong', 'other') then raise exception 'invalid_reason'; end if;
  select v.user_id into v_owner from public.beer_reviews v where v.id = p_id and v.status <> 'removed';
  if v_owner is null then raise exception 'not_found'; end if;
  if v_owner = v_uid then raise exception 'own_review'; end if;
  if (select count(*) from public.beer_review_reports r where r.reporter_id = v_uid and r.created_at > now() - interval '1 day') >= 10 then
    raise exception 'slow_down';
  end if;
  insert into public.beer_review_reports (review_id, reporter_id, reason, note)
  values (p_id, v_uid, p_reason, nullif(left(btrim(coalesce(p_note, '')), 200), ''))
  on conflict (review_id, reporter_id) do nothing;
  select count(*) into v_n from public.beer_review_reports r where r.review_id = p_id;
  update public.beer_reviews set report_count = v_n,
         status = case when v_n >= 3 and status = 'live' then 'hidden' else status end
   where id = p_id
  returning status into v_status;
  return jsonb_build_object('count', v_n, 'hidden', v_status = 'hidden');
end $$;

-- ---------- grants: the RPCs for signed-in users only (anonymous sign-ins are 'authenticated' too); helpers for nobody ----------
do $$
declare
  f text;
  v_rpcs text[] := array['public.beerlib_favs_mine()', 'public.beerlib_fav_set(integer, text)', 'public.beerlib_privacy(text)',
    'public.beerlib_favs_for(text, uuid, text)', 'public.beerlib_rate(text, integer)', 'public.beerlib_beer_get(text)',
    'public.beerlib_review_post(text, text, integer)', 'public.beerlib_review_remove(bigint)', 'public.beerlib_review_report(bigint, text, text)'];
begin
  foreach f in array v_rpcs loop
    execute 'revoke all on function ' || f || ' from public';
    execute 'revoke all on function ' || f || ' from anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;

select public.olnu_strip_cr();
