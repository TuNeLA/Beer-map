-- Öl Nu v26 — 🚩 "Fel plats / stängt?" reports from the bar sheet + owner view (stats.html). Additive.
-- Rows are never removed; the owner marks them done ('fixed' = bar set inactive / moved, 'ignored').
-- Needs: olnu_uid, olnu_world_ok, bars_lite, olnu_wd_owner_ok (0031).

create table if not exists public.bar_reports (
  id          bigserial primary key,
  bar_id      text not null check (char_length(bar_id) between 1 and 80),
  bar_name    text check (bar_name is null or char_length(bar_name) <= 60),
  kind        text not null check (kind in ('closed', 'wrong_place', 'duplicate', 'not_bar', 'other')),
  note        text check (note is null or char_length(note) <= 200),
  bar_lat     float8,
  bar_lng     float8,
  user_lat    float8,                                     -- rounded to 0.001 (~100 m), only to judge "wrong place"
  user_lng    float8,
  user_id     uuid not null,
  status      text not null default 'new' check (status in ('new', 'fixed', 'ignored')),
  created_at  timestamptz not null default now(),
  status_at   timestamptz
);
create index if not exists bar_reports_bar_ix on public.bar_reports (bar_id, created_at);
create index if not exists bar_reports_user_ix on public.bar_reports (user_id, created_at);
alter table public.bar_reports enable row level security;
revoke all on public.bar_reports from anon, authenticated;
revoke all on sequence public.bar_reports_id_seq from anon, authenticated;

-- report_bar → {ok, id, already, reports}. One report per user per bar per 7 days (the same id comes back,
-- already=true, the kind/note are updated); max 10 new reports per user per day and 1 per 20 s → slow_down.
-- Errors: invalid_bar, invalid_kind, invalid_msg (note > 200 or links), slow_down.
create or replace function public.report_bar(p_bar_id text, p_bar_name text, p_kind text, p_note text default null,
  p_lat float8 default null, p_lng float8 default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_bar text := left(btrim(regexp_replace(coalesce(p_bar_id, ''), '[[:cntrl:]]', '', 'g')), 80);
  v_name text := left(nullif(btrim(regexp_replace(coalesce(p_bar_name, ''), '[[:cntrl:]]', ' ', 'g')), ''), 60);
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), '');
  b record; v_id bigint; v_old bigint; v_n int;
begin
  if v_bar = '' then raise exception 'invalid_bar'; end if;
  if v_kind not in ('closed', 'wrong_place', 'duplicate', 'not_bar', 'other') then raise exception 'invalid_kind'; end if;
  if v_note is not null and (char_length(v_note) > 200 or v_note ~* '(https?://|www\.)') then raise exception 'invalid_msg'; end if;
  select x.lat, x.lng, x.name into b from public.bars_lite x where x.id = v_bar;
  select r.id into v_old from public.bar_reports r
   where r.user_id = v_uid and r.bar_id = v_bar and r.created_at > now() - interval '7 days' order by r.id desc limit 1;
  if v_old is not null then
    update public.bar_reports r set kind = v_kind, note = coalesce(v_note, r.note) where r.id = v_old;
    v_id := v_old;
  else
    if exists (select 1 from public.bar_reports r where r.user_id = v_uid and r.created_at > now() - interval '20 seconds')
       or (select count(*) from public.bar_reports r where r.user_id = v_uid and r.created_at > now() - interval '1 day') >= 10 then
      raise exception 'slow_down';
    end if;
    insert into public.bar_reports (bar_id, bar_name, kind, note, bar_lat, bar_lng, user_lat, user_lng, user_id)
    values (v_bar, coalesce(v_name, left(b.name, 60)), v_kind, v_note, b.lat, b.lng,
            case when public.olnu_world_ok(p_lat, p_lng) then round(p_lat::numeric, 3) end,
            case when public.olnu_world_ok(p_lat, p_lng) then round(p_lng::numeric, 3) end, v_uid)
    returning id into v_id;
  end if;
  select count(distinct r.user_id) into v_n from public.bar_reports r where r.bar_id = v_bar and r.status = 'new';
  return jsonb_build_object('ok', true, 'id', v_id, 'already', v_old is not null, 'reports', v_n);
end; $$;

-- Owner list: one row per bar with new reports (counts per kind, notes, server row state).
create or replace function public.owner_bar_reports(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'total_new', (select count(*) from public.bar_reports r where r.status = 'new'),
    'bars', coalesce((select jsonb_agg(x order by (x->>'users')::int desc, x->>'last_at' desc) from (
      select jsonb_build_object('bar_id', r.bar_id, 'bar_name', max(r.bar_name), 'users', count(distinct r.user_id), 'reports', count(*),
        'kinds', (select jsonb_object_agg(k.kind, k.n) from (select r2.kind, count(*) n from public.bar_reports r2 where r2.bar_id = r.bar_id and r2.status = 'new' group by 1) k),
        'notes', (select coalesce(jsonb_agg(n.note order by n.created_at desc), '[]'::jsonb) from (select r3.note, r3.created_at from public.bar_reports r3 where r3.bar_id = r.bar_id and r3.status = 'new' and r3.note is not null order by r3.created_at desc limit 5) n),
        'user_pos', (select coalesce(jsonb_agg(jsonb_build_array(p.user_lat, p.user_lng)), '[]'::jsonb) from (select distinct r4.user_lat, r4.user_lng from public.bar_reports r4 where r4.bar_id = r.bar_id and r4.status = 'new' and r4.kind = 'wrong_place' and r4.user_lat is not null limit 5) p),
        'lat', max(r.bar_lat), 'lng', max(r.bar_lng),
        'active', (select b.active from public.bars_lite b where b.id = r.bar_id),
        'first_at', min(r.created_at), 'last_at', max(r.created_at)) x
      from public.bar_reports r where r.status = 'new' group by r.bar_id limit 300) q), '[]'::jsonb));
end; $$;

-- Owner action per bar: 'close' (bars_lite.active = false + reports fixed), 'reopen' (active = true),
-- 'ignore' (reports ignored). Also add the id to docs/bars-closed.json so the next bars.json import keeps it out.
create or replace function public.owner_bar_action(p_key text, p_bar_id text, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_a text := lower(btrim(coalesce(p_action, ''))); v_n int;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if v_a not in ('close', 'reopen', 'ignore') then raise exception 'invalid_action'; end if;
  if v_a = 'close' then
    update public.bars_lite b set active = false, updated_at = now() where b.id = p_bar_id;
    update public.bar_reports r set status = 'fixed', status_at = now() where r.bar_id = p_bar_id and r.status = 'new';
  elsif v_a = 'reopen' then
    update public.bars_lite b set active = true, updated_at = now() where b.id = p_bar_id;
  else
    update public.bar_reports r set status = 'ignored', status_at = now() where r.bar_id = p_bar_id and r.status = 'new';
  end if;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'action', v_a, 'rows', v_n);
end; $$;

revoke all on function public.report_bar(text, text, text, text, float8, float8) from public, anon;
revoke all on function public.owner_bar_reports(text) from public;
revoke all on function public.owner_bar_action(text, text, text) from public;
grant execute on function public.report_bar(text, text, text, text, float8, float8) to authenticated;
grant execute on function public.owner_bar_reports(text) to anon, authenticated;
grant execute on function public.owner_bar_action(text, text, text) to anon, authenticated;
grant all on public.bar_reports to service_role;
