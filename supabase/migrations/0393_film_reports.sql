-- 0346 ENGÅNGSKAMERAN · ANMÄL / TA BORT a developed photo. ADDITIVE ONLY: one new table, two new functions, film_save_list
-- (0345, same owner) again with one more filter. Idempotent.
-- Why: the camera rules (shown once before the first shot) say "the one who took it can remove it, everyone can report it".
-- Before this, a film photo could not be reported at all (report_content 'photo' = chat photos only; ugc_reports.kind
-- has no film kind, and changing that check is not additive).
--   film_remove(photo)          → the photographer removes his own photo: bytes emptied, expires now (UPDATE, no row removed).
--   film_report(photo, reason)  → one report per person per photo. The photo is hidden for the reporter at once
--                                 (film_save_list + the app), and for everyone when 2 different members reported it.
--                                 Max 10 reports per hour per person (slow_down).
-- film_reports.user_id = the reporter (the "Radera mina data" sweep covers every public uuid column named user_id).
-- Owner panel: these reports are NOT in ugc_reports / owner_reports yet (follow-up for the safety owner).

create table if not exists public.film_reports (
  photo_id   bigint not null,
  user_id    uuid not null,
  reason     text not null check (reason in ('hat', 'sex', 'hot', 'spam', 'minor', 'drog', 'annat')),
  created_at timestamptz not null default now(),
  primary key (photo_id, user_id)
);
alter table public.film_reports enable row level security;
revoke all on table public.film_reports from public, anon, authenticated;

create or replace function public.film_remove(p_photo_id bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.snap_photos;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.snap_photos sp where sp.id = p_photo_id and sp.kind = 'film';
  if not found or v_row.user_id is distinct from v_uid then raise exception 'photo_not_found'; end if;
  update public.snap_photos sp set bytes = null, expires_at = least(sp.expires_at, now()) where sp.id = p_photo_id;
  return jsonb_build_object('ok', true, 'id', p_photo_id);
end; $function$;

create or replace function public.film_report(p_photo_id bigint, p_reason text default 'annat')
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.snap_photos;
  v_reason text := case when p_reason in ('hat', 'sex', 'hot', 'spam', 'minor', 'drog', 'annat') then p_reason else 'annat' end;
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
  insert into public.film_reports (photo_id, user_id, reason) values (p_photo_id, v_uid, v_reason) on conflict (photo_id, user_id) do nothing;
  select count(distinct r.user_id) into v_n from public.film_reports r where r.photo_id = p_photo_id and r.user_id is distinct from v_row.user_id;
  if v_n >= 2 then
    update public.snap_photos sp set bytes = null, expires_at = least(sp.expires_at, now()) where sp.id = p_photo_id;
  end if;
  return jsonb_build_object('ok', true, 'id', p_photo_id, 'hidden_all', v_n >= 2);
end; $function$;

create or replace function public.film_save_list(p_group_id uuid, p_night timestamptz)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_rev timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if p_night is null then raise exception 'photo_not_found'; end if;
  v_rev := (select min(sp.reveal_at) from public.snap_photos sp where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = p_night);
  if v_rev is null or v_rev > now() then
    return jsonb_build_object('night', p_night, 'developed', false, 'photos', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'night', p_night, 'developed', true, 'evening', public.olnu_evening(p_night),
    'group_name', (select g.name from public.groups g where g.id = p_group_id),
    'film', (select s.film from public.film_stocks s where s.group_id = p_group_id and s.night = p_night),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', sp.id, 'w', sp.w, 'h', sp.h, 'at', sp.created_at) order by sp.created_at, sp.id)
                          from public.snap_photos sp
                         where sp.group_id = p_group_id and sp.kind = 'film' and sp.night = p_night
                           and sp.bytes is not null and sp.expires_at > now()
                           and exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = sp.user_id)
                           and not public.olnu_ub_hidden(v_uid, sp.user_id)
                           and not exists (select 1 from public.film_reports fr where fr.photo_id = sp.id and fr.user_id = v_uid)), '[]'::jsonb));
end; $function$;

revoke all on function public.film_remove(bigint) from public, anon;
revoke all on function public.film_report(bigint, text) from public, anon;
grant execute on function public.film_remove(bigint) to authenticated;
grant execute on function public.film_report(bigint, text) to authenticated;
