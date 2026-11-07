-- 0175 handover: move a logged-in anonymous account to the new address (PintsNow, pintsnow.com) with a
-- one-time ticket. Additive. No row-removing statements.
--
-- Why: localStorage (the anonymous Supabase session) belongs to ONE origin. The old origin
-- (https://tunela.github.io) makes the ticket, the new origin (https://pintsnow.com) takes it.
--
-- How:
--   * The OLD origin (signed in) makes 32 random bytes S. id = base64url(S[0..16]), key = S[16..32].
--     It encrypts the move payload (refresh token, user id, name, a few olnu.* settings) with AES-GCM(key)
--     and calls handover_put(id, box). The server keeps only sha256(id) and the ciphertext. The key is
--     never sent to the server: it travels only in the URL #fragment (https://pintsnow.com/#pn=<S>) or in
--     a first-party cookie that iOS copies into a new home-screen app.
--   * The NEW origin (no session yet, anon key) calls handover_take(id) -> {box, u}, decrypts, and
--     signs in with the refresh token (same user id, so nothing in the database has to move).
--   * One use: a ticket can be taken again only within 2 minutes of the first take (reload / bad network),
--     max 3 takes. It expires 30 minutes after it was made. A leaked link is useless after that.
--   * handover_done(id) (new origin, now signed in as the same user) marks the move as finished and
--     blanks the ciphertext.
--   * handover_status(id) lets the old origin decide if a retry is safe (never taken = safe).

create table if not exists public.handover_tickets (
  id_hash    text primary key,                 -- sha256 hex of the ticket id (the id itself is not stored)
  user_id    uuid not null,
  box        text not null,                    -- base64url(iv || AES-GCM ciphertext); '' after done
  src        text,                             -- frozen | bridge | home | settings
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  taken_at   timestamptz,
  takes      int not null default 0,
  done_at    timestamptz
);
create index if not exists handover_tickets_user_idx on public.handover_tickets (user_id, created_at desc);
create index if not exists handover_tickets_created_idx on public.handover_tickets (created_at desc);
alter table public.handover_tickets enable row level security;
revoke all on public.handover_tickets from public, anon, authenticated;

create or replace function public.olnu_ho_hash(p_id text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(p_id, 'sha256'), 'hex');
$$;
revoke all on function public.olnu_ho_hash(text) from public, anon, authenticated;

-- Old origin, signed in. Returns {ok, expires_at}.
create or replace function public.handover_put(p_id text, p_box text, p_src text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.olnu_uid();
  v_exp timestamptz := now() + interval '30 minutes';
begin
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{20,64}$' then raise exception 'bad_ticket'; end if;
  if p_box is null or char_length(p_box) < 24 or char_length(p_box) > 8000 or p_box !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'bad_box';
  end if;
  if (select count(*) from public.handover_tickets t
       where t.user_id = v_uid and t.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate_limited';
  end if;
  insert into public.handover_tickets (id_hash, user_id, box, src, expires_at)
  values (public.olnu_ho_hash(p_id), v_uid, p_box, left(coalesce(p_src, ''), 16), v_exp);
  return jsonb_build_object('ok', true, 'expires_at', v_exp);
exception when unique_violation then
  raise exception 'bad_ticket';
end;
$$;

-- New origin, no session needed (anon key). Returns {box, u} or raises handover_gone.
create or replace function public.handover_take(p_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  r public.handover_tickets%rowtype;
begin
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{20,64}$' then raise exception 'handover_gone'; end if;
  select * into r from public.handover_tickets where id_hash = public.olnu_ho_hash(p_id) for update;
  if not found or r.done_at is not null or r.box = '' or r.expires_at < now() then raise exception 'handover_gone'; end if;
  if r.taken_at is not null and (now() - r.taken_at > interval '2 minutes' or r.takes >= 3) then
    raise exception 'handover_gone';
  end if;
  update public.handover_tickets
     set taken_at = coalesce(taken_at, now()), takes = takes + 1
   where id_hash = r.id_hash;
  return jsonb_build_object('box', r.box, 'u', r.user_id);
end;
$$;

-- New origin, signed in as the moved user. Idempotent.
create or replace function public.handover_done(p_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.olnu_uid();
  n int;
begin
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{20,64}$' then return jsonb_build_object('ok', false); end if;
  update public.handover_tickets
     set done_at = coalesce(done_at, now()), box = ''
   where id_hash = public.olnu_ho_hash(p_id) and user_id = v_uid;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end;
$$;

-- Old origin: is a retry safe? open (not taken yet) | expired (never taken) | taken | done | unknown.
create or replace function public.handover_status(p_id text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select coalesce((
    select case
             when t.done_at is not null then 'done'
             when t.taken_at is not null then 'taken'
             when t.expires_at < now() then 'expired'
             else 'open' end
      from public.handover_tickets t
     where p_id ~ '^[A-Za-z0-9_-]{20,64}$' and t.id_hash = public.olnu_ho_hash(p_id)), 'unknown');
$$;

revoke all on function public.handover_put(text, text, text) from public, anon;
revoke all on function public.handover_take(text) from public;
revoke all on function public.handover_done(text) from public, anon;
revoke all on function public.handover_status(text) from public;
grant execute on function public.handover_put(text, text, text) to authenticated;
grant execute on function public.handover_take(text) to anon, authenticated;
grant execute on function public.handover_done(text) to authenticated;
grant execute on function public.handover_status(text) to anon, authenticated;
-- (owner_move_stats: see 0176)
