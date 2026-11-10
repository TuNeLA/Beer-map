-- 0400 MISC · MODERATION: film photo reports in the owner queue (F3) + block the photographer (X5). OWNER-RUN at release.
-- Additive only: one new table, new functions, and CREATE OR REPLACE of film_report (0393) and safety_state (0206)
-- with the same arguments and the same answer shape. No row-removing or object-removing statement in this file.
-- Why a new table: ugc_reports.kind has a check without a film kind, and widening a check is not additive.
-- So the owner panel (docs/stats-reports.js) reads film reports from owner_film_reports() and shows them in the same
-- "Anmälningar" queue as the chat reports.
--   film_mod                      one row per handled film photo: status new/dismissed/hidden/warned, DSA notice,
--                                 auto_hidden + prev_expires_at (so "OK" can bring back a photo that 2 reports hid).
--   film_report (replaced)        2 reports now hide the photo by expires_at = now() (soft hide, the bytes stay for the
--                                 owner until the normal retention). Before: bytes = null (the owner could not see it).
--                                 After an owner "OK", only newer reports count.
--   owner_film_reports(key, st)   the queue (open = a report newer than the last owner action).
--   owner_film_act(key, id, act)  dismiss | hide | warn | hide_all (same words as owner_report_act, 0208).
--   owner_film_photo(key, id)     the reported photo as base64 (owner only).
--   film_block(photo)             block the person who took the photo (no user id goes to the client).
--   safety_state (replaced)       also returns the film notices (DSA art. 17) for the photographer.
-- Needs 0393 (film_reports, film_report) and 0206/0208 (user_blocks, ugc_reports, olnu_wd_owner_ok).

create table if not exists public.film_mod (
  photo_id        bigint primary key,
  target          uuid,                      -- the photographer (the 0209 sweep anonymises it)
  status          text not null default 'new' check (status in ('new', 'dismissed', 'hidden', 'warned')),
  auto_hidden     boolean not null default false,
  prev_expires_at timestamptz,
  created_at      timestamptz not null default now(),
  handled_at      timestamptz,
  notice          text,
  notice_seen     boolean not null default false
);
alter table public.film_mod enable row level security;
revoke all on table public.film_mod from public, anon, authenticated;
create index if not exists film_mod_target on public.film_mod (target) where notice is not null and not notice_seen;
create index if not exists film_reports_photo on public.film_reports (photo_id, created_at);

-- 🚩 film_report: same rules as 0393 (one report per person, 10 per hour, hidden for the reporter at once).
-- 2 different reporters (not the photographer): hidden for everyone by expires_at (soft), and the owner sees it.
create or replace function public.film_report(p_photo_id bigint, p_reason text default 'annat')
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.snap_photos;
  v_reason text := case when p_reason in ('hat', 'sex', 'hot', 'spam', 'minor', 'drog', 'annat') then p_reason else 'annat' end;
  v_since timestamptz;
  v_st text;
  v_n int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.snap_photos sp where sp.id = p_photo_id and sp.kind = 'film' and sp.reveal_at <= now();
  if not found then raise exception 'photo_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_film_rep:' || v_uid::text, 0));
  if (select count(*) from public.film_reports r where r.user_id = v_uid and r.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'slow_down';
  end if;
  insert into public.film_reports (photo_id, user_id, reason) values (p_photo_id, v_uid, v_reason)
  on conflict (photo_id, user_id) do nothing;
  select fm.status, case when fm.status = 'dismissed' then fm.handled_at end into v_st, v_since
    from public.film_mod fm where fm.photo_id = p_photo_id;
  select count(distinct r.user_id) into v_n from public.film_reports r
   where r.photo_id = p_photo_id and r.user_id is distinct from v_row.user_id
     and r.created_at > coalesce(v_since, '-infinity'::timestamptz);
  if v_n >= 2 and coalesce(v_st, 'new') <> 'hidden' then
    insert into public.film_mod as fm (photo_id, target, status, auto_hidden, prev_expires_at)
    values (p_photo_id, v_row.user_id, 'new', true, v_row.expires_at)
    on conflict (photo_id) do update
      set status = 'new', auto_hidden = true, target = excluded.target,
          prev_expires_at = case when fm.auto_hidden then fm.prev_expires_at else excluded.prev_expires_at end;
    update public.snap_photos sp set expires_at = least(sp.expires_at, now()) where sp.id = p_photo_id;
  end if;
  return jsonb_build_object('ok', true, 'id', p_photo_id, 'hidden_all', v_n >= 2);
end; $function$;

-- The owner queue. p_status: 'new' (open) | 'hidden' | 'warned' | 'dismissed' | 'all'.
-- "Open" = at least one report newer than the last owner action on that photo.
create or replace function public.owner_film_reports(p_key text, p_status text default 'new')
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_st text := coalesce(p_status, 'new'); v jsonb;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  with p as (
    select r.photo_id, max(r.created_at) as last_at from public.film_reports r group by r.photo_id
    order by max(r.created_at) desc limit 1000
  ), x as (
    select p.photo_id, sp.user_id as author, sp.bytes is not null as has_bytes, sp.expires_at,
           fm.status as fst, fm.handled_at, coalesce(fm.auto_hidden, false) as auto_hidden,
           (select count(distinct r.user_id) from public.film_reports r
             where r.photo_id = p.photo_id and r.created_at > coalesce(fm.handled_at, '-infinity'::timestamptz))::int as n_open,
           (select count(distinct r.user_id) from public.film_reports r where r.photo_id = p.photo_id)::int as n_all,
           (select min(r.created_at) from public.film_reports r
             where r.photo_id = p.photo_id and r.created_at > coalesce(fm.handled_at, '-infinity'::timestamptz)) as first_open,
           (select min(r.created_at) from public.film_reports r where r.photo_id = p.photo_id) as first_at,
           (select mode() within group (order by r.reason) from public.film_reports r where r.photo_id = p.photo_id) as reason
      from p
      left join public.snap_photos sp on sp.id = p.photo_id
      left join public.film_mod fm on fm.photo_id = p.photo_id
  ), y as (
    select x.*, case when x.n_open > 0 then 'new' else coalesce(x.fst, 'new') end as st from x
  )
  select jsonb_build_object(
    'generated_at', now(),
    'open', (select count(*) from y where y.st = 'new'),
    'oldest_open_h', (select round(extract(epoch from now() - min(y.first_open)) / 3600.0, 1) from y where y.st = 'new'),
    'reports', coalesce((select jsonb_agg(jsonb_build_object(
        'id', y.photo_id, 'kind', 'film', 'ref', y.photo_id::text, 'reason', y.reason, 'note', null,
        'excerpt', '[🎞️ ' || y.photo_id::text || ']', 'status', y.st,
        'created_at', coalesce(y.first_open, y.first_at), 'handled_at', y.handled_at,
        'same', case when y.st = 'new' then y.n_open else y.n_all end,
        'author_30d', case when y.author is null then 0 else
            (select count(*) from public.ugc_reports u where u.target = y.author and u.created_at > now() - interval '30 days')
          + (select count(*) from public.film_reports r join public.snap_photos s2 on s2.id = r.photo_id
              where s2.user_id = y.author and r.created_at > now() - interval '30 days') end,
        'author', case when y.author is null then null else substr(md5(y.author::text || ':olnu-rep'), 1, 8) end,
        'film_id', y.photo_id, 'photo', y.has_bytes, 'live', y.has_bytes and y.expires_at > now(), 'auto_hidden', y.auto_hidden)
        order by coalesce(y.first_open, y.first_at) desc)
      from (select * from y where v_st = 'all' or y.st = v_st order by coalesce(y.first_open, y.first_at) desc limit 300) y), '[]'::jsonb))
  into v;
  return v;
end; $function$;

-- dismiss: no action (an auto-hidden photo comes back if it has not run out) · hide: gone for everyone + a notice to
-- the photographer · warn: a notice only · hide_all: hide + end all of that person's live chat text, photos, voice and
-- film photos now.
create or replace function public.owner_film_act(p_key text, p_photo_id bigint, p_action text, p_notice text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_sp public.snap_photos;
  v_fm public.film_mod;
  v_notice text := nullif(left(btrim(coalesce(p_notice, '')), 300), '');
  v_back boolean := false;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if p_action is null or p_action not in ('dismiss', 'hide', 'warn', 'hide_all') then raise exception 'invalid_action'; end if;
  if not exists (select 1 from public.film_reports r where r.photo_id = p_photo_id) then raise exception 'not_found'; end if;
  select * into v_sp from public.snap_photos sp where sp.id = p_photo_id;
  select * into v_fm from public.film_mod fm where fm.photo_id = p_photo_id;
  insert into public.film_mod (photo_id, target, prev_expires_at) values (p_photo_id, v_sp.user_id, v_sp.expires_at)
  on conflict (photo_id) do nothing;
  if p_action in ('hide', 'hide_all') then
    v_notice := coalesce(v_notice, 'En bild du tog med engångskameran togs bort efter en anmälan, för att den bröt mot Reglerna. Frågor: support@pintsnow.com');
    update public.snap_photos sp set expires_at = least(sp.expires_at, now()) where sp.id = p_photo_id;
    if p_action = 'hide_all' and v_sp.user_id is not null then
      update public.snap_photos sp set expires_at = least(sp.expires_at, now()) where sp.user_id = v_sp.user_id and sp.kind = 'film' and sp.expires_at > now();
      update public.group_msgs m set expires_at = least(m.expires_at, now()) where m.user_id = v_sp.user_id and m.expires_at > now();
      update public.chat_photos c set expires_at = least(c.expires_at, now()) where c.user_id = v_sp.user_id and c.expires_at > now();
      update public.voice_msgs v set expires_at = least(v.expires_at, now()) where v.user_id = v_sp.user_id and v.expires_at > now();
    end if;
  elsif p_action = 'warn' then
    v_notice := coalesce(v_notice, 'Hej! Någon anmälde en bild du tog med engångskameran. Håll god ton i gänget, la. Reglerna finns under ⚙️.');
  else
    v_notice := null;
    -- bring back a photo that 2 reports hid, if it has bytes and its normal time has not run out
    if coalesce(v_fm.auto_hidden, false) and v_fm.prev_expires_at > now() and v_sp.bytes is not null then
      update public.snap_photos sp set expires_at = v_fm.prev_expires_at where sp.id = p_photo_id;
      v_back := true;
    end if;
  end if;
  update public.film_mod fm
     set status = case p_action when 'dismiss' then 'dismissed' when 'warn' then 'warned' else 'hidden' end,
         handled_at = now(), notice = v_notice, notice_seen = false,
         auto_hidden = case when p_action = 'dismiss' then false else fm.auto_hidden end,
         target = coalesce(fm.target, v_sp.user_id)
   where fm.photo_id = p_photo_id;
  return jsonb_build_object('ok', true, 'status', p_action, 'restored', v_back);
end; $function$;

create or replace function public.owner_film_photo(p_key text, p_photo_id bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_sp public.snap_photos;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  select * into v_sp from public.snap_photos sp
   where sp.id = p_photo_id and sp.kind = 'film' and exists (select 1 from public.film_reports r where r.photo_id = p_photo_id);
  if v_sp.id is null or v_sp.bytes is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'mime', coalesce(v_sp.mime, 'image/jpeg'), 'b64', replace(encode(v_sp.bytes, 'base64'), E'\n', ''));
end; $function$;

-- 🚫 Block the person who took a developed film photo (same table and rules as block_user, 0206).
create or replace function public.film_block(p_photo_id bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.snap_photos;
  v_name text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.snap_photos sp where sp.id = p_photo_id and sp.kind = 'film' and sp.reveal_at <= now();
  if not found then raise exception 'photo_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if v_row.user_id is null or v_row.user_id = v_uid then raise exception 'own_content'; end if;
  if (select count(*) from public.user_blocks k where k.blocker = v_uid and k.updated_at > now() - interval '1 minute') >= 10 then
    raise exception 'slow_down';
  end if;
  v_name := left(coalesce((select m.display_name from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_row.user_id),
                          public.olnu_friend_name(v_row.user_id), '?'), 30);
  insert into public.user_blocks as k (blocker, blocked, active, name)
  values (v_uid, v_row.user_id, true, v_name)
  on conflict (blocker, blocked) do update set active = true, name = coalesce(k.name, excluded.name), updated_at = now();
  update public.friendships f set status = 'removed', ended_by = v_uid, updated_at = now()
   where ((f.a = v_uid and f.b = v_row.user_id) or (f.b = v_uid and f.a = v_row.user_id)) and f.status in ('accepted', 'pending');
  return jsonb_build_object('ok', true, 'on', true, 'name', v_name,
                            'id', substr(md5(v_uid::text || ':' || v_row.user_id::text || ':olnu-ub'), 1, 16));
end; $function$;

-- safety_state (0206) + the film notices. Same keys; notices from film_mod get a negative id (-photo id).
create or replace function public.safety_state(p_seen boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); s public.user_safety; v_not jsonb; v_film jsonb;
begin
  select * into s from public.user_safety x where x.user_id = v_uid;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'text', r.notice, 'at', r.handled_at) order by r.handled_at), '[]'::jsonb)
    into v_not from public.ugc_reports r where r.target = v_uid and r.notice is not null and not r.notice_seen;
  select coalesce(jsonb_agg(jsonb_build_object('id', -fm.photo_id, 'kind', 'film', 'text', fm.notice, 'at', fm.handled_at) order by fm.handled_at), '[]'::jsonb)
    into v_film from public.film_mod fm where fm.target = v_uid and fm.notice is not null and not fm.notice_seen;
  if coalesce(p_seen, false) then
    update public.ugc_reports r set notice_seen = true where r.target = v_uid and r.notice is not null and not r.notice_seen;
    update public.film_mod fm set notice_seen = true where fm.target = v_uid and fm.notice is not null and not fm.notice_seen;
  end if;
  return jsonb_build_object('v', 1, 'age_ok', s.age_ok, 'age_checked_at', s.age_checked_at,
    'terms_ver', s.terms_ver, 'terms_at', s.terms_at, 'store', public.olnu_store_on(),
    'blocks', (select count(*) from public.user_blocks k where k.blocker = v_uid and k.active),
    'notices', v_not || v_film);
end; $$;

revoke all on function public.film_block(bigint) from public, anon;
grant execute on function public.film_block(bigint) to authenticated;
revoke all on function public.film_report(bigint, text) from public, anon;
grant execute on function public.film_report(bigint, text) to authenticated;
revoke all on function public.safety_state(boolean) from public, anon;
grant execute on function public.safety_state(boolean) to authenticated;
grant execute on function public.owner_film_reports(text, text) to anon, authenticated;
grant execute on function public.owner_film_act(text, bigint, text, text) to anon, authenticated;
grant execute on function public.owner_film_photo(text, bigint) to anon, authenticated;
