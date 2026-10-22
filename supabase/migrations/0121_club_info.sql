-- Öl Nu — 🚪 Entré-info per club (CONTRACT "⏰ ÖPPETTIDER · 🍾 SYSTEMET · 💰 PRIS · 🚪 ENTRÉ · 🌭 NATTMAT").
-- Users suggest "Åldersgräns 20 · Entré 100 kr · Klädkod: ingen keps"; the owner approves in stats.html (same pattern as
-- 0095 bar areas: owner key, anon may run only the two owner functions). The owner's own trusted app account
-- (bar_area_trusted, "📱 Den här mobilen är min") is approved at once. The live queue ("Kö nu") stays the v12 report_queue.
-- Additive: one new table + functions. Rows are never removed: status pending → ok | rejected, older approved rows superseded.

create table if not exists public.club_info (
  id            bigserial primary key,
  bar_id        text not null check (char_length(bar_id) between 1 and 80),
  user_id       uuid not null,
  age           int check (age between 18 and 30),
  fee           int check (fee between 0 and 1000),
  dress         text check (dress is null or char_length(dress) between 2 and 40),
  bar_lat       double precision not null,
  bar_lng       double precision not null,
  status        text not null default 'pending' check (status in ('pending', 'ok', 'rejected')),
  auto          boolean not null default false,
  created_at    timestamptz not null default now(),
  status_at     timestamptz,
  superseded_at timestamptz
);
create index if not exists club_info_bar_idx on public.club_info (bar_id, status) where superseded_at is null;
create index if not exists club_info_user_idx on public.club_info (user_id, created_at desc);
alter table public.club_info enable row level security;
revoke all on public.club_info from anon, authenticated;
revoke all on sequence public.club_info_id_seq from anon, authenticated;
grant all on public.club_info to service_role;

-- Approved info of one bar (newest ok, not superseded) or null.
create or replace function public.olnu_aio_club(p_bar_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('age', c.age, 'fee', c.fee, 'dress', c.dress, 'at', coalesce(c.status_at, c.created_at))
    from public.club_info c
   where c.bar_id = p_bar_id and c.status = 'ok' and c.superseded_at is null
   order by coalesce(c.status_at, c.created_at) desc limit 1;
$$;

create or replace function public.olnu_aio_club_supersede(p_bar_id text, p_keep bigint)
returns void language sql security definer set search_path = public as $$
  update public.club_info c set superseded_at = now()
   where c.bar_id = p_bar_id and c.status = 'ok' and c.superseded_at is null and c.id <> p_keep;
$$;

create or replace function public.suggest_club_info(p_bar_id text, p_age int default null, p_fee int default null, p_dress text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_pos double precision[];
  v_dress text := nullif(regexp_replace(btrim(coalesce(p_dress, '')), '\s+', ' ', 'g'), '');
  v_trust boolean; v_status text; v_id bigint;
begin
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 then raise exception 'invalid_bar'; end if;
  v_pos := public.olnu_area_bar_pos(p_bar_id);
  if v_pos is null then raise exception 'invalid_bar'; end if;
  if p_age is not null and (p_age < 18 or p_age > 30) then raise exception 'invalid_info'; end if;
  if p_fee is not null and (p_fee < 0 or p_fee > 1000) then raise exception 'invalid_info'; end if;
  if v_dress is not null and (char_length(v_dress) not between 2 and 40
       or v_dress ~* '(https?:|www\.|\.(se|com|nu|net|org)\b|@|\d{7,})') then
    raise exception 'invalid_info';
  end if;
  if p_age is null and p_fee is null and v_dress is null then raise exception 'invalid_info'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-club:' || v_uid::text, 0));
  if (select count(*) from public.club_info c where c.user_id = v_uid and c.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'slow_down';
  end if;
  v_trust := exists (select 1 from public.bar_area_trusted t where t.user_id = v_uid and t.active);
  v_status := case when v_trust then 'ok' else 'pending' end;
  update public.club_info c set superseded_at = now()
   where c.user_id = v_uid and c.bar_id = p_bar_id and c.status = 'pending' and c.superseded_at is null;
  insert into public.club_info (bar_id, user_id, age, fee, dress, bar_lat, bar_lng, status, auto, status_at)
  values (p_bar_id, v_uid, p_age, p_fee, v_dress, v_pos[1], v_pos[2], v_status, v_trust, case when v_trust then now() end)
  returning id into v_id;
  if v_trust then perform public.olnu_aio_club_supersede(p_bar_id, v_id); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status, 'auto', v_trust);
end; $$;

create or replace function public.owner_club_info(p_key text, p_status text default 'pending')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s text := lower(coalesce(nullif(btrim(p_status), ''), 'pending'));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'counts', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (
                 select x.status s, count(*) n from public.club_info x where x.superseded_at is null group by 1) c),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'bar_id', a.bar_id, 'bar_lat', a.bar_lat, 'bar_lng', a.bar_lng,
                 'bar_name', (select b.name from public.bars_lite b where b.id = a.bar_id),
                 'bar_type', (select b.type from public.bars_lite b where b.id = a.bar_id),
                 'age', a.age, 'fee', a.fee, 'dress', a.dress, 'status', a.status, 'auto', a.auto,
                 'created_at', a.created_at, 'superseded', a.superseded_at is not null,
                 'by_n', (select count(*) from public.club_info y where y.user_id = a.user_id),
                 'current', public.olnu_aio_club(a.bar_id))
               order by a.created_at desc)
              from (select * from public.club_info x
                     where (v_s = 'all' or x.status = v_s) and (x.superseded_at is null or v_s = 'all')
                     order by x.created_at desc limit 100) a), '[]'::jsonb));
end; $$;

create or replace function public.owner_set_club_info(p_key text, p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s text := lower(btrim(coalesce(p_status, ''))); a public.club_info;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if v_s not in ('pending', 'ok', 'rejected') then raise exception 'invalid_status'; end if;
  update public.club_info x set status = v_s, status_at = now(),
         superseded_at = case when v_s = 'ok' then null else x.superseded_at end
   where x.id = p_id returning * into a;
  if not found then raise exception 'info_not_found'; end if;
  if v_s = 'ok' then perform public.olnu_aio_club_supersede(a.bar_id, a.id); end if;
  return jsonb_build_object('ok', true, 'id', a.id, 'status', v_s, 'bar_id', a.bar_id);
end; $$;

do $$
begin
  execute 'revoke all on function public.olnu_aio_club(text), public.olnu_aio_club_supersede(text, bigint), public.suggest_club_info(text, int, int, text), public.owner_club_info(text, text), public.owner_set_club_info(text, bigint, text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_aio_club(text), public.olnu_aio_club_supersede(text, bigint), public.suggest_club_info(text, int, int, text) from anon';
    execute 'grant execute on function public.owner_club_info(text, text), public.owner_set_club_info(text, bigint, text) to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_aio_club(text), public.olnu_aio_club_supersede(text, bigint) from authenticated';
    execute 'grant execute on function public.suggest_club_info(text, int, int, text), public.owner_club_info(text, text), public.owner_set_club_info(text, bigint, text) to authenticated';
  end if;
end $$;
