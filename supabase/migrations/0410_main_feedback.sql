-- 0410 MAIN · "NÅGOT KNAS?" (X6): a feedback button in the ⋯ menu and in Inställningar. OWNER-RUN at release.
-- Additive only: one new table and new functions. No row-removing or object-removing statement in this file.
--   feedback                 one row per report: the text, a small JPEG screenshot (data URL), the last 200 log lines,
--                            the beta id (commit) + a few short meta keys, and a status for the owner panel.
--   submit_knas(...)         for the app (signed in): max 5 per user per 24 h, 10 s apart → { ok, id, left }.
--   owner_knas(key)          the owner panel list (no screenshots: has_shot only), newest first, max 300.
--   owner_knas_shot(key, id) one screenshot.   owner_set_knas(key, id, status)   ny · läst · fixad · dold.
-- Retention: the account removal function of 0209 / 0402 does not know this table yet. Owner step at release:
-- add the feedback table to it (same pattern as the meriter_carry line), or keep the rows (no names inside, user_id only).
-- The client works before this file runs: on a "function not found" answer it sends the text through submit_feedback (0215).

create table if not exists public.feedback (
  id         bigserial primary key,
  user_id    uuid,
  body       text not null,
  shot       text check (shot is null or (char_length(shot) <= 600000 and shot ~ '^data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+$')),
  logs       jsonb not null default '[]'::jsonb check (jsonb_typeof(logs) = 'array'),
  beta       text,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  status     text not null default 'ny' check (status in ('ny', 'läst', 'fixad', 'dold'))
);
create index if not exists feedback_created on public.feedback (created_at desc);
create index if not exists feedback_user_created on public.feedback (user_id, created_at desc);
alter table public.feedback enable row level security;
revoke all on table public.feedback from public, anon, authenticated;
revoke all on sequence public.feedback_id_seq from public, anon, authenticated;

create or replace function public.submit_knas(p_text text, p_shot text default null, p_logs jsonb default '[]'::jsonb, p_meta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_body text := nullif(left(regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]', ' ', 'g'), 1000), '');
  v_shot text := nullif(p_shot, '');
  v_logs jsonb := '[]'::jsonb;
  v_meta jsonb := '{}'::jsonb;
  v_n    int;
  v_id   bigint;
begin
  if v_uid is null then raise exception 'not_authed'; end if;
  if v_body is null or char_length(trim(v_body)) < 3 then raise exception 'too_short'; end if;
  if v_shot is not null and (char_length(v_shot) > 600000 or v_shot !~ '^data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+$') then raise exception 'bad_shot'; end if;
  -- logs: the last 200 lines, text only, 300 chars each
  if jsonb_typeof(p_logs) = 'array' then
    select coalesce(jsonb_agg(left(regexp_replace(x.v, '[[:cntrl:]]', ' ', 'g'), 300) order by x.o), '[]'::jsonb) into v_logs
      from (select e.v, e.o from jsonb_array_elements_text(p_logs) with ordinality as e(v, o) order by e.o desc limit 200) x;
  end if;
  -- meta: only a few short known keys, text only
  if jsonb_typeof(p_meta) = 'object' then
    select coalesce(jsonb_object_agg(k, left(p_meta->>k, 300)), '{}'::jsonb) into v_meta
      from unnest(array['v', 'beta', 'ua', 'screen', 'err', 'w', 'h', 'standalone', 'from', 'net']) k where p_meta ? k;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_knas:' || v_uid::text, 0));
  select count(*) into v_n from public.feedback f where f.user_id = v_uid and f.created_at > now() - interval '1 day';
  if v_n >= 5 or exists (select 1 from public.feedback f where f.user_id = v_uid and f.created_at > now() - interval '10 seconds') then
    raise exception 'slow_down';
  end if;
  insert into public.feedback (user_id, body, shot, logs, beta, meta)
    values (v_uid, v_body, v_shot, v_logs, nullif(left(v_meta->>'beta', 40), ''), v_meta)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'left', greatest(0, 4 - v_n));
end; $$;

create or replace function public.owner_knas(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'counts', (select jsonb_build_object('all', count(*), 'ny', count(*) filter (where f.status = 'ny'),
                 'day', count(*) filter (where f.created_at > now() - interval '1 day')) from public.feedback f where f.status <> 'dold'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'body', f.body, 'beta', f.beta, 'meta', f.meta, 'logs', f.logs,
               'has_shot', f.shot is not null, 'status', f.status, 'created_at', f.created_at, 'test', public.olnu_is_test_user(f.user_id)) order by f.id desc)
              from (select * from public.feedback x where x.status <> 'dold' order by x.id desc limit 300) f), '[]'::jsonb));
end; $$;

create or replace function public.owner_knas_shot(p_key text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('id', p_id, 'shot', (select f.shot from public.feedback f where f.id = p_id));
end; $$;

create or replace function public.owner_set_knas(p_key text, p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if p_status not in ('ny', 'läst', 'fixad', 'dold') then raise exception 'invalid_status'; end if;
  update public.feedback f set status = p_status where f.id = p_id;
  return jsonb_build_object('ok', found);
end; $$;

revoke all on function public.submit_knas(text, text, jsonb, jsonb) from public, anon;
revoke all on function public.owner_knas(text) from public;
revoke all on function public.owner_knas_shot(text, bigint) from public;
revoke all on function public.owner_set_knas(text, bigint, text) from public;
grant execute on function public.submit_knas(text, text, jsonb, jsonb) to authenticated;
grant execute on function public.owner_knas(text) to anon, authenticated;
grant execute on function public.owner_knas_shot(text, bigint) to anon, authenticated;
grant execute on function public.owner_set_knas(text, bigint, text) to anon, authenticated;
