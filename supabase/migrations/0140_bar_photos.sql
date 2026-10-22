-- Öl Nu — 📸 BILDER PÅ KROGEN (photos per bar; CONTRACT "📸 KROGBILDER · ☀️ UTEVÄDER · 🏠 FÖLJ MIG HEM · 🔍 HITTA KOMPIS").
-- Additive only. Needs 0001 (olnu_uid, group_members), 0012 (olnu_night_of), 0015 (bars_lite), 0028 (chat_photos),
-- 0040 (snap_photos), 0084/0136 (olnu_is_temp_group), 0095 (olnu_wd_owner_ok).
-- Rows are never removed: a public share ends with public_until / pub_bytes = null, moderation sets hidden_at.
-- Privacy:
--   * A photo is tagged to a bar only from what the server already knows about the photographer at that moment:
--     a live check-in (< 3 h) or a live, visible, PRECISE pin with a drink in the last 2 h that lies within 60 m of a bar.
--     "Bara område" and ghost pins never tag. DM and event-chat photos never tag (olnu_is_temp_group).
--   * Skåltimme photos are never tagged ("post to see" rule). Film photos only show after the 10:00 reveal.
--   * Group photos are shown ONLY to members of the photo's own group. Never public by default.
--   * "🌍 Dela med alla på krogen": only the photographer, max 7 days, no name, no group; anyone can report / hide;
--     3 reports hide it for everyone; the owner moderates in stats.html.

create table if not exists public.bar_photos (
  id           bigserial primary key,
  kind         text not null check (kind in ('chat', 'film')),
  photo_id     bigint not null,
  group_id     uuid not null,
  user_id      uuid not null,
  bar_id       text not null,
  bar_name     text,
  bar_lat      double precision,
  bar_lng      double precision,
  via          text not null default 'pin' check (via in ('checkin', 'pin')),
  night        timestamptz not null,
  taken_at     timestamptz not null default now(),
  w            int not null default 0,
  h            int not null default 0,
  public_at    timestamptz,
  public_until timestamptz,
  pub_mime     text,
  pub_bytes    bytea,
  reports      int not null default 0,
  hidden_at    timestamptz,
  hidden_by    text check (hidden_by is null or hidden_by in ('reports', 'owner')),
  unique (kind, photo_id)
);
create index if not exists bar_photos_bar_idx on public.bar_photos (bar_id, taken_at desc);
create index if not exists bar_photos_pub_idx on public.bar_photos (bar_id, public_until) where public_until is not null;
create index if not exists bar_photos_user_idx on public.bar_photos (user_id, public_at);

create table if not exists public.bar_photo_reports (
  bp_id      bigint not null references public.bar_photos (id),
  user_id    uuid not null,
  reason     text,
  created_at timestamptz not null default now(),
  primary key (bp_id, user_id)
);
create index if not exists bar_photo_reports_user_idx on public.bar_photo_reports (user_id, created_at desc);

alter table public.bar_photos enable row level security;
alter table public.bar_photo_reports enable row level security;
revoke all on public.bar_photos, public.bar_photo_reports from anon, authenticated;
revoke all on sequence public.bar_photos_id_seq from anon, authenticated;
grant all on public.bar_photos, public.bar_photo_reports to service_role;
grant usage, select on sequence public.bar_photos_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Where was the photographer? (bar within 60 m, from a check-in or a precise pin)
-- ---------------------------------------------------------------------------
create or replace function public.olnu_bp_m(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable set search_path = public as $$
  select 6371000 * 2 * asin(least(1, sqrt(power(sin(radians(b_lat - a_lat) / 2), 2) +
         cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2))));
$$;

create or replace function public.olnu_bp_where(p_uid uuid, p_at timestamptz)
returns table (bar_id text, bar_name text, bar_lat double precision, bar_lng double precision, via text)
language plpgsql stable security definer set search_path = public as $$
declare
  c record; b record; br record;
begin
  -- 1. Live check-in (the check-in sits on the bar point).
  select ci.bar_id, ci.bar_name, ci.lat, ci.lng into c
    from public.checkins ci
   where ci.user_id = p_uid and ci.expires_at > p_at and ci.created_at > p_at - interval '3 hours'
     and ci.created_at <= p_at + interval '1 minute'
   order by ci.created_at desc limit 1;
  if found and c.bar_id is not null and c.lat is not null then
    bar_id := c.bar_id; bar_name := c.bar_name; bar_lat := c.lat; bar_lng := c.lng; via := 'checkin';
    return next; return;
  end if;
  -- 2. Live, visible, precise pin with a drink in the last 2 h → nearest bar within 60 m.
  select x.lat, x.lng into b
    from public.beers x
   where x.user_id = p_uid and x.expires_at > p_at and not coalesce(x.stopped, false) and not coalesce(x.ghost, false)
     and coalesce(x.precise, false)
     and greatest(coalesce(x.beer_at, x.created_at), coalesce(x.other_at, x.created_at), x.updated_at) > p_at - interval '2 hours'
   limit 1;
  if not found or b.lat is null then return; end if;
  select l.id, l.name, l.lat, l.lng, public.olnu_bp_m(b.lat, b.lng, l.lat, l.lng) as d into br
    from public.bars_lite l
   where l.active and l.lat between b.lat - 0.0007 and b.lat + 0.0007
     and l.lng between b.lng - 0.0014 and b.lng + 0.0014
   order by public.olnu_bp_m(b.lat, b.lng, l.lat, l.lng) limit 1;
  if found and br.d <= 60 then
    bar_id := br.id; bar_name := br.name; bar_lat := br.lat; bar_lng := br.lng; via := 'pin';
    return next;
  end if;
  return;
end; $$;

create or replace function public.olnu_bp_tag(p_kind text, p_photo bigint, p_group uuid, p_uid uuid, p_at timestamptz, p_w int, p_h int)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if p_group is null or p_uid is null then return; end if;
  if public.olnu_is_temp_group(p_group) then return; end if;
  select * into r from public.olnu_bp_where(p_uid, p_at) limit 1;
  if not found or r.bar_id is null then return; end if;
  insert into public.bar_photos (kind, photo_id, group_id, user_id, bar_id, bar_name, bar_lat, bar_lng, via, night, taken_at, w, h)
  values (p_kind, p_photo, p_group, p_uid, r.bar_id, left(r.bar_name, 80), r.bar_lat, r.bar_lng, r.via,
          public.olnu_night_of(p_at), p_at, coalesce(p_w, 0), coalesce(p_h, 0))
  on conflict (kind, photo_id) do nothing;
end; $$;

create or replace function public.olnu_bp_chat_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.olnu_bp_tag('chat', new.id, new.group_id, new.user_id, new.created_at, new.w, new.h);
  exception when others then null;
  end;
  return null;
end; $$;

create or replace function public.olnu_bp_film_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind is distinct from 'film' then return null; end if;
  begin
    perform public.olnu_bp_tag('film', new.id, new.group_id, new.user_id, new.created_at, new.w, new.h);
  exception when others then null;
  end;
  return null;
end; $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'olnu_zz_bp_chat') then
    create trigger olnu_zz_bp_chat after insert on public.chat_photos for each row execute function public.olnu_bp_chat_tg();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'olnu_zz_bp_film') then
    create trigger olnu_zz_bp_film after insert on public.snap_photos for each row execute function public.olnu_bp_film_tg();
  end if;
end $$;

-- "Radera allt om mig" (0016 sweep moves user_id): end the public share and empty its copy.
create or replace function public.olnu_bp_anon_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is distinct from old.user_id then
    new.pub_bytes := null;
    new.public_until := least(coalesce(new.public_until, now()), now());
  end if;
  return new;
end; $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'bar_photos_anon') then
    create trigger bar_photos_anon before update of user_id on public.bar_photos for each row execute function public.olnu_bp_anon_tg();
  end if;
end $$;

-- Is the source photo still there (bytes kept, not expired; film developed)?
create or replace function public.olnu_bp_alive(p public.bar_photos)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if p.kind = 'chat' then
    return exists (select 1 from public.chat_photos c where c.id = p.photo_id and c.bytes is not null and c.expires_at > now());
  end if;
  return exists (select 1 from public.snap_photos s where s.id = p.photo_id and s.kind = 'film' and s.bytes is not null
                   and s.expires_at > now() and s.reveal_at is not null and s.reveal_at <= now());
end; $$;

create or replace function public.olnu_bp_pub(p public.bar_photos)
returns boolean language sql stable set search_path = public as $$
  select p.public_until is not null and p.public_until > now() and p.hidden_at is null and p.pub_bytes is not null;
$$;

create or replace function public.olnu_bp_key(p_id bigint)
returns text language sql immutable set search_path = public as $$ select 'bp' || p_id::text; $$;

create or replace function public.olnu_bp_id(p_key text)
returns bigint language sql immutable set search_path = public as $$
  select case when coalesce(p_key, '') ~ '^bp[0-9]{1,18}$' then substr(p_key, 3)::bigint end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs (authenticated only)
-- ---------------------------------------------------------------------------
-- bar_photos(p_bar_id) → {v, now, bar_id, group:[...], public:[...]}
create or replace function public.bar_photos(p_bar_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_g jsonb; v_p jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_bar_id is null or char_length(p_bar_id) > 120 then raise exception 'invalid_bar'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', public.olnu_bp_key(x.id), 'kind', x.kind, 'w', x.w, 'h', x.h, 'at', x.taken_at,
           'by', (select m.display_name from public.group_members m where m.group_id = x.group_id and m.user_id = x.user_id),
           'group_name', (select g.name from public.groups g where g.id = x.group_id),
           'is_me', x.user_id = v_uid,
           'shared', x.pub,
           'can_share', x.user_id = v_uid and x.hidden_by is distinct from 'owner',
           'public_until', case when x.pub then x.public_until end)
         order by x.taken_at desc), '[]'::jsonb)
    into v_g
    from (select p.id, p.kind, p.w, p.h, p.taken_at, p.group_id, p.user_id, p.hidden_by, p.public_until,
                 public.olnu_bp_pub(p) as pub
            from public.bar_photos p
           where p.bar_id = p_bar_id and p.taken_at > now() - interval '8 days'
             and exists (select 1 from public.group_members m where m.group_id = p.group_id and m.user_id = v_uid)
             and public.olnu_bp_alive(p)
           order by p.taken_at desc limit 24) x;
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', public.olnu_bp_key(x.id), 'w', x.w, 'h', x.h, 'at', x.taken_at, 'is_me', x.user_id = v_uid,
           'public_until', x.public_until)
         order by x.public_at desc), '[]'::jsonb)
    into v_p
    from (select p.id, p.w, p.h, p.taken_at, p.user_id, p.public_until, p.public_at
            from public.bar_photos p
           where p.bar_id = p_bar_id and p.public_until > now() and p.hidden_at is null and p.pub_bytes is not null
             and not exists (select 1 from public.bar_photo_reports r where r.bp_id = p.id and r.user_id = v_uid)
             and not (exists (select 1 from public.group_members m where m.group_id = p.group_id and m.user_id = v_uid)
                      and public.olnu_bp_alive(p) and p.taken_at > now() - interval '8 days')
           order by p.public_at desc limit 24) x;
  return jsonb_build_object('v', 1, 'now', now(), 'bar_id', p_bar_id, 'group', v_g, 'public', v_p);
end; $$;

-- bar_photo(p_key) → {key, mime, w, h, b64}
create or replace function public.bar_photo(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  p public.bar_photos; v_b bytea; v_m text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into p from public.bar_photos x where x.id = public.olnu_bp_id(p_key);
  if not found then raise exception 'photo_not_found'; end if;
  if exists (select 1 from public.group_members m where m.group_id = p.group_id and m.user_id = v_uid) then
    if p.kind = 'chat' then
      select c.bytes, c.mime into v_b, v_m from public.chat_photos c where c.id = p.photo_id and c.expires_at > now();
    else
      select s.bytes, s.mime into v_b, v_m from public.snap_photos s
       where s.id = p.photo_id and s.kind = 'film' and s.expires_at > now() and s.reveal_at <= now();
    end if;
  end if;
  if v_b is null and public.olnu_bp_pub(p) then v_b := p.pub_bytes; v_m := p.pub_mime; end if;
  if v_b is null then raise exception 'photo_not_found'; end if;
  return jsonb_build_object('key', p_key, 'mime', coalesce(v_m, 'image/jpeg'), 'w', p.w, 'h', p.h, 'b64', encode(v_b, 'base64'));
end; $$;

-- bar_photo_share(p_key, p_on) → photographer only. On = public copy for 7 days. Off = ends at once.
create or replace function public.bar_photo_share(p_key text, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  p public.bar_photos; v_b bytea; v_m text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- space: shares that ran out give their copy back (the row stays)
  update public.bar_photos set pub_bytes = null where pub_bytes is not null and public_until < now();
  select * into p from public.bar_photos x where x.id = public.olnu_bp_id(p_key) for update;
  if not found or p.user_id <> v_uid then raise exception 'photo_not_found'; end if;
  if not coalesce(p_on, true) then
    update public.bar_photos set public_until = least(coalesce(public_until, now()), now()), pub_bytes = null where id = p.id;
    return jsonb_build_object('key', p_key, 'shared', false);
  end if;
  if p.hidden_by = 'owner' then raise exception 'not_allowed'; end if;
  if public.olnu_bp_pub(p) then return jsonb_build_object('key', p_key, 'shared', true, 'public_until', p.public_until); end if;
  if (select count(*) from public.bar_photos x where x.user_id = v_uid and x.public_at > now() - interval '24 hours') >= 20 then
    raise exception 'slow_down';
  end if;
  if p.kind = 'chat' then
    select c.bytes, c.mime into v_b, v_m from public.chat_photos c where c.id = p.photo_id and c.expires_at > now();
  else
    select s.bytes, s.mime into v_b, v_m from public.snap_photos s
     where s.id = p.photo_id and s.kind = 'film' and s.expires_at > now() and s.reveal_at <= now();
  end if;
  if v_b is null then raise exception 'photo_not_found'; end if;
  update public.bar_photos
     set public_at = now(), public_until = now() + interval '7 days', pub_bytes = v_b, pub_mime = coalesce(v_m, 'image/jpeg')
   where id = p.id;
  return jsonb_build_object('key', p_key, 'shared', true, 'public_until', now() + interval '7 days');
end; $$;

-- bar_photo_report(p_key, p_reason) → hides it for me at once; 3 reports hide it for everyone.
create or replace function public.bar_photo_report(p_key text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  p public.bar_photos; v_n int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into p from public.bar_photos x where x.id = public.olnu_bp_id(p_key) for update;
  if not found or not public.olnu_bp_pub(p) then raise exception 'photo_not_found'; end if;
  if p.user_id = v_uid then raise exception 'own_photo'; end if;
  if (select count(*) from public.bar_photo_reports r where r.user_id = v_uid and r.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'slow_down';
  end if;
  insert into public.bar_photo_reports (bp_id, user_id, reason)
  values (p.id, v_uid, left(nullif(btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]+', ' ', 'g')), ''), 40))
  on conflict do nothing;
  select count(*) into v_n from public.bar_photo_reports r where r.bp_id = p.id;
  update public.bar_photos
     set reports = v_n,
         hidden_at = case when v_n >= 3 and hidden_at is null then now() else hidden_at end,
         hidden_by = case when v_n >= 3 and hidden_at is null then 'reports' else hidden_by end
   where id = p.id;
  return jsonb_build_object('ok', true, 'hidden', v_n >= 3);
end; $$;

-- ---------------------------------------------------------------------------
-- Owner moderation (stats.html; anon + owner key, like 0121)
-- ---------------------------------------------------------------------------
create or replace function public.owner_bar_photos(p_key text, p_status text default 'public')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s text := lower(coalesce(nullif(btrim(p_status), ''), 'public'));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'counts', jsonb_build_object(
       'public', (select count(*) from public.bar_photos x where x.public_until > now() and x.hidden_at is null),
       'reported', (select count(*) from public.bar_photos x where x.public_until > now() and x.reports > 0 and x.hidden_at is null),
       'hidden', (select count(*) from public.bar_photos x where x.hidden_at is not null and x.public_at > now() - interval '30 days'),
       'tagged_7d', (select count(*) from public.bar_photos x where x.taken_at > now() - interval '7 days')),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'bar_id', a.bar_id, 'bar_name', a.bar_name, 'kind', a.kind,
               'taken_at', a.taken_at, 'public_at', a.public_at, 'public_until', a.public_until, 'live', a.public_until > now(),
               'reports', a.reports, 'reasons', (select coalesce(jsonb_agg(r.reason) filter (where r.reason is not null), '[]'::jsonb)
                                                  from public.bar_photo_reports r where r.bp_id = a.id),
               'hidden_at', a.hidden_at, 'hidden_by', a.hidden_by, 'w', a.w, 'h', a.h, 'has_img', a.pub_bytes is not null,
               'by_n', (select count(*) from public.bar_photos y where y.user_id = a.user_id and y.public_at is not null))
             order by a.reports desc, a.public_at desc)
             from (select * from public.bar_photos x
                    where x.public_at is not null and x.public_at > now() - interval '30 days'
                      and (v_s = 'all'
                           or (v_s = 'public' and x.public_until > now() and x.hidden_at is null)
                           or (v_s = 'reported' and x.reports > 0)
                           or (v_s = 'hidden' and x.hidden_at is not null))
                    order by x.public_at desc limit 100) a), '[]'::jsonb));
end; $$;

create or replace function public.owner_bar_photo(p_key text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.bar_photos;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  select * into p from public.bar_photos x where x.id = p_id;
  if not found or p.pub_bytes is null then raise exception 'photo_not_found'; end if;
  return jsonb_build_object('id', p.id, 'mime', coalesce(p.pub_mime, 'image/jpeg'), 'w', p.w, 'h', p.h, 'b64', encode(p.pub_bytes, 'base64'));
end; $$;

create or replace function public.owner_set_bar_photo(p_key text, p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s text := lower(btrim(coalesce(p_status, '')));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if v_s not in ('ok', 'hidden') then raise exception 'invalid_status'; end if;
  update public.bar_photos
     set hidden_at = case when v_s = 'hidden' then coalesce(hidden_at, now()) end,
         hidden_by = case when v_s = 'hidden' then 'owner' end
   where id = p_id;
  if not found then raise exception 'photo_not_found'; end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', v_s);
end; $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$ begin
  execute 'revoke all on function public.olnu_bp_m(double precision, double precision, double precision, double precision), public.olnu_bp_where(uuid, timestamptz), public.olnu_bp_tag(text, bigint, uuid, uuid, timestamptz, int, int), public.olnu_bp_chat_tg(), public.olnu_bp_film_tg(), public.olnu_bp_anon_tg(), public.olnu_bp_alive(public.bar_photos), public.olnu_bp_pub(public.bar_photos), public.olnu_bp_key(bigint), public.olnu_bp_id(text), public.bar_photos(text), public.bar_photo(text), public.bar_photo_share(text, boolean), public.bar_photo_report(text, text), public.owner_bar_photos(text, text), public.owner_bar_photo(text, bigint), public.owner_set_bar_photo(text, bigint, text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_bp_m(double precision, double precision, double precision, double precision), public.olnu_bp_chat_tg(), public.olnu_bp_film_tg(), public.olnu_bp_anon_tg(), public.olnu_bp_pub(public.bar_photos), public.olnu_bp_key(bigint), public.olnu_bp_id(text), public.olnu_bp_where(uuid, timestamptz), public.olnu_bp_tag(text, bigint, uuid, uuid, timestamptz, int, int), public.olnu_bp_alive(public.bar_photos), public.bar_photos(text), public.bar_photo(text), public.bar_photo_share(text, boolean), public.bar_photo_report(text, text) from anon';
    execute 'grant execute on function public.owner_bar_photos(text, text), public.owner_bar_photo(text, bigint), public.owner_set_bar_photo(text, bigint, text) to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_bp_m(double precision, double precision, double precision, double precision), public.olnu_bp_chat_tg(), public.olnu_bp_film_tg(), public.olnu_bp_anon_tg(), public.olnu_bp_pub(public.bar_photos), public.olnu_bp_key(bigint), public.olnu_bp_id(text), public.olnu_bp_where(uuid, timestamptz), public.olnu_bp_tag(text, bigint, uuid, uuid, timestamptz, int, int), public.olnu_bp_alive(public.bar_photos) from authenticated';
    execute 'grant execute on function public.bar_photos(text), public.bar_photo(text), public.bar_photo_share(text, boolean), public.bar_photo_report(text, text), public.owner_bar_photos(text, text), public.owner_bar_photo(text, bigint), public.owner_set_bar_photo(text, bigint, text) to authenticated';
  end if;
  execute 'grant execute on function public.olnu_bp_where(uuid, timestamptz), public.olnu_bp_tag(text, bigint, uuid, uuid, timestamptz, int, int), public.olnu_bp_alive(public.bar_photos) to service_role';
end $$;
