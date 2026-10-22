-- Öl Nu — 🚫 STÄNGT FÖR GOTT RPCs (CONTRACT "🚫 STÄNGT FÖR GOTT"). Needs 0147, 0095 (bar_area_trusted, olnu_area_bar_pos,
-- olnu_wd_owner_ok owner key). Additive: new functions only.
--  report_bar_gone(bar_id, name)  authenticated. One live report per user and place, max 10 reports / 24 h per user.
--     2 different users (reports newer than the last owner undo) or 1 report from the owner's trusted phone → hidden for everyone.
--  report_bar_gone_withdraw(bar_id) authenticated: take my report back (a place already hidden stays hidden; the owner decides).
--  bars_gone()                    authenticated: { v, ids: [...] } = every hidden / confirmed place (the client merges it with
--                                 docs/bars-closed.json and caches it).
--  owner_bars_gone(key, status)   stats.html: hidden / confirmed / undone / pending (1 report, not hidden yet) / all.
--  owner_set_bar_gone(key, bar_id, status) stats.html: confirmed | undone | hidden (a pending one can be hidden at once).

create or replace function public.olnu_gone_count(p_bar_id text)
returns int language sql stable security definer set search_path = public as $$
  select count(distinct r.user_id)::int from public.bar_gone_reports r
   where r.bar_id = p_bar_id and r.withdrawn_at is null
     and r.created_at > coalesce((select g.status_at from public.bar_gone g where g.bar_id = p_bar_id and g.status = 'undone'), '-infinity'::timestamptz);
$$;

create or replace function public.report_bar_gone(p_bar_id text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_pos double precision[];
  v_name text := left(nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), ''), 60);
  v_trust boolean; v_n int; v_cur text; v_hidden boolean := false; v_reason text;
begin
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 then raise exception 'invalid_bar'; end if;
  v_pos := public.olnu_area_bar_pos(p_bar_id);
  if v_pos is null then raise exception 'invalid_bar'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-gone:' || p_bar_id, 0));
  select g.status into v_cur from public.bar_gone g where g.bar_id = p_bar_id;
  if v_cur in ('hidden', 'confirmed') then
    return jsonb_build_object('ok', true, 'hidden', true, 'already', true, 'reports', public.olnu_gone_count(p_bar_id));
  end if;
  if exists (select 1 from public.bar_gone_reports r where r.bar_id = p_bar_id and r.user_id = v_uid and r.withdrawn_at is null
               and r.created_at > coalesce((select g.status_at from public.bar_gone g where g.bar_id = p_bar_id and g.status = 'undone'), '-infinity'::timestamptz)) then
    return jsonb_build_object('ok', true, 'hidden', false, 'mine', true, 'reports', public.olnu_gone_count(p_bar_id), 'need', 2);
  end if;
  if (select count(*) from public.bar_gone_reports r where r.user_id = v_uid and r.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'slow_down';
  end if;
  v_trust := exists (select 1 from public.bar_area_trusted t where t.user_id = v_uid and t.active);
  -- an older live report of mine from before an owner undo: withdraw it, the new one counts
  update public.bar_gone_reports r set withdrawn_at = now() where r.bar_id = p_bar_id and r.user_id = v_uid and r.withdrawn_at is null;
  insert into public.bar_gone_reports (bar_id, user_id, name, bar_lat, bar_lng, trusted)
  values (p_bar_id, v_uid, v_name, v_pos[1], v_pos[2], v_trust);
  v_n := public.olnu_gone_count(p_bar_id);
  if v_trust or v_n >= 2 then
    v_hidden := true; v_reason := case when v_trust then 'trusted' else 'crowd' end;
    insert into public.bar_gone (bar_id, name, bar_lat, bar_lng, status, reason, reports, hidden_at, status_at)
    values (p_bar_id, coalesce(v_name, (select max(r.name) from public.bar_gone_reports r where r.bar_id = p_bar_id and r.withdrawn_at is null),
                    (select b.name from public.bars_lite b where b.id = p_bar_id)), v_pos[1], v_pos[2], 'hidden', v_reason, v_n, now(), now())
    on conflict (bar_id) do update set status = 'hidden', reason = excluded.reason, reports = excluded.reports,
      name = coalesce(public.bar_gone.name, excluded.name), hidden_at = now(), status_at = now();
  end if;
  return jsonb_build_object('ok', true, 'hidden', v_hidden, 'trusted', v_trust, 'reports', v_n, 'need', 2);
end; $$;

create or replace function public.report_bar_gone_withdraw(p_bar_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_n int;
begin
  update public.bar_gone_reports r set withdrawn_at = now() where r.bar_id = p_bar_id and r.user_id = v_uid and r.withdrawn_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'withdrawn', v_n > 0);
end; $$;

create or replace function public.bars_gone()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  return jsonb_build_object('v', 1, 'server_time', now(),
    'ids', coalesce((select jsonb_agg(g.bar_id order by g.bar_id) from public.bar_gone g where g.status in ('hidden', 'confirmed')), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(distinct r.bar_id) from public.bar_gone_reports r
                       where r.user_id = v_uid and r.withdrawn_at is null and r.created_at > now() - interval '90 days'), '[]'::jsonb));
end; $$;

create or replace function public.owner_bars_gone(p_key text, p_status text default 'hidden')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s text := lower(coalesce(nullif(btrim(p_status), ''), 'hidden'));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'counts', (select jsonb_build_object(
                 'hidden', (select count(*) from public.bar_gone g where g.status = 'hidden'),
                 'confirmed', (select count(*) from public.bar_gone g where g.status = 'confirmed'),
                 'undone', (select count(*) from public.bar_gone g where g.status = 'undone'),
                 'pending', (select count(distinct r.bar_id) from public.bar_gone_reports r where r.withdrawn_at is null
                               and not exists (select 1 from public.bar_gone g where g.bar_id = r.bar_id and g.status in ('hidden', 'confirmed'))
                               and public.olnu_gone_count(r.bar_id) > 0))),
    'rows', coalesce((select jsonb_agg(s.x order by s.x->>'at' desc) from (
        select jsonb_build_object('bar_id', g.bar_id, 'name', coalesce(g.name, (select b.name from public.bars_lite b where b.id = g.bar_id)),
                 'type', (select b.type from public.bars_lite b where b.id = g.bar_id), 'lat', g.bar_lat, 'lng', g.bar_lng,
                 'status', g.status, 'reason', g.reason, 'reports', public.olnu_gone_count(g.bar_id), 'at', g.status_at, 'hidden_at', g.hidden_at) x
          from public.bar_gone g where v_s in (g.status, 'all')
        union all
        select jsonb_build_object('bar_id', r.bar_id, 'name', coalesce(max(r.name), (select b.name from public.bars_lite b where b.id = r.bar_id)),
                 'type', (select b.type from public.bars_lite b where b.id = r.bar_id), 'lat', min(r.bar_lat), 'lng', min(r.bar_lng),
                 'status', 'pending', 'reason', null, 'reports', public.olnu_gone_count(r.bar_id), 'at', max(r.created_at), 'hidden_at', null) as x
          from public.bar_gone_reports r
         where v_s in ('pending', 'all') and r.withdrawn_at is null
           and not exists (select 1 from public.bar_gone g where g.bar_id = r.bar_id and g.status in ('hidden', 'confirmed'))
         group by r.bar_id having public.olnu_gone_count(r.bar_id) > 0
        limit 200) s), '[]'::jsonb));
end; $$;

create or replace function public.owner_set_bar_gone(p_key text, p_bar_id text, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s text := lower(btrim(coalesce(p_status, ''))); v_pos double precision[];
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if v_s not in ('hidden', 'confirmed', 'undone') then raise exception 'invalid_status'; end if;
  if exists (select 1 from public.bar_gone g where g.bar_id = p_bar_id) then
    update public.bar_gone g set status = v_s, status_at = now(),
           reason = case when v_s = 'undone' then g.reason when g.status = 'undone' then 'owner' else g.reason end,
           hidden_at = case when v_s <> 'undone' and g.status = 'undone' then now() else g.hidden_at end
     where g.bar_id = p_bar_id;
  else
    if v_s = 'undone' then raise exception 'not_found'; end if;
    v_pos := public.olnu_area_bar_pos(p_bar_id);
    if v_pos is null then raise exception 'invalid_bar'; end if;
    insert into public.bar_gone (bar_id, name, bar_lat, bar_lng, status, reason, reports)
    values (p_bar_id, coalesce((select max(r.name) from public.bar_gone_reports r where r.bar_id = p_bar_id), (select b.name from public.bars_lite b where b.id = p_bar_id)),
            v_pos[1], v_pos[2], v_s, 'owner', public.olnu_gone_count(p_bar_id));
  end if;
  return jsonb_build_object('ok', true, 'bar_id', p_bar_id, 'status', v_s);
end; $$;

do $$
begin
  execute 'revoke all on function public.olnu_gone_count(text), public.report_bar_gone(text, text), public.report_bar_gone_withdraw(text), public.bars_gone(), public.owner_bars_gone(text, text), public.owner_set_bar_gone(text, text, text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_gone_count(text), public.report_bar_gone(text, text), public.report_bar_gone_withdraw(text), public.bars_gone() from anon';
    -- owner panels run on stats.html with the anon key + the owner key (same as owner_club_info)
    execute 'grant execute on function public.owner_bars_gone(text, text), public.owner_set_bar_gone(text, text, text) to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_gone_count(text) from authenticated';
    execute 'grant execute on function public.report_bar_gone(text, text), public.report_bar_gone_withdraw(text), public.bars_gone(), public.owner_bars_gone(text, text), public.owner_set_bar_gone(text, text, text) to authenticated';
  end if;
end $$;
