-- Öl Nu — 🔑 TAPPAT DITT KONTO: take today's groups along when logging in to a saved account (CONTRACT "KONTO").
-- Flow (docs/js/account.js): the phone has an UNSAVED anonymous account A with groups, the user logs in to the saved
-- account B with an e-mail code and chooses to keep B (the default) and bring A's groups.
--   1. While still signed in as A:  account_merge_ticket()  → {ticket, groups[], n}. Only an anonymous caller may make one
--      (so nobody can pull a saved account's groups away). The ticket is random, stored only as a sha256 hash, one use,
--      30 minutes, max 6 per hour per user.
--   2. After verifyOtp, signed in as B:  account_merge_claim(p_ticket)  → {moved, skipped, groups[]}. Only a permanent
--      caller. Moves A's group_members rows to B where B is not already a member (UPDATE user_id; display name kept),
--      and groups A created get created_by = B. Rows for groups B is already in stay with A (A is left behind).
--   Every claim is audited in account_merge_tickets (from_uid, to_uid, used_at, groups_moved, groups_skipped).
-- Additive: one new table, two new functions (authenticated only). Rows are never removed; tickets expire.

create table if not exists public.account_merge_tickets (
  id             bigserial primary key,
  from_uid       uuid not null,
  ticket_hash    text not null unique,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default (now() + interval '30 minutes'),
  used_at        timestamptz,
  to_uid         uuid,
  groups_moved   int,
  groups_skipped int
);
create index if not exists account_merge_tickets_from_idx on public.account_merge_tickets (from_uid, created_at desc);
alter table public.account_merge_tickets enable row level security;
revoke all on public.account_merge_tickets from anon, authenticated;
grant all on public.account_merge_tickets to service_role;

create or replace function public.account_merge_ticket()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_ticket text;
  v_groups jsonb;
begin
  if not coalesce((select u.is_anonymous from auth.users u where u.id = v_uid), false) then
    raise exception 'not_anonymous';
  end if;
  if (select count(*) from public.account_merge_tickets t where t.from_uid = v_uid and t.created_at > now() - interval '1 hour') >= 6 then
    raise exception 'rate_limited';
  end if;
  v_ticket := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.account_merge_tickets (from_uid, ticket_hash)
    values (v_uid, encode(sha256(convert_to(v_ticket, 'UTF8')), 'hex'));
  select coalesce(jsonb_agg(g.name order by m.joined_at desc), '[]'::jsonb) into v_groups
    from public.group_members m join public.groups g on g.id = m.group_id where m.user_id = v_uid;
  return jsonb_build_object('ticket', v_ticket, 'groups', v_groups, 'n', jsonb_array_length(v_groups));
end;
$$;

create or replace function public.account_merge_claim(p_ticket text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_t public.account_merge_tickets%rowtype;
  v_moved int := 0;
  v_skipped int := 0;
  v_names jsonb := '[]'::jsonb;
begin
  if coalesce((select u.is_anonymous from auth.users u where u.id = v_uid), true) then
    raise exception 'not_permanent';
  end if;
  if p_ticket is null or char_length(p_ticket) < 32 or char_length(p_ticket) > 80 then
    raise exception 'ticket_invalid';
  end if;
  select * into v_t from public.account_merge_tickets t
   where t.ticket_hash = encode(sha256(convert_to(p_ticket, 'UTF8')), 'hex')
     and t.used_at is null and t.expires_at > now()
   for update;
  if not found then
    raise exception 'ticket_invalid';
  end if;
  if v_t.from_uid <> v_uid then
    select coalesce(jsonb_agg(g.name), '[]'::jsonb) into v_names
      from public.group_members m join public.groups g on g.id = m.group_id
     where m.user_id = v_t.from_uid
       and not exists (select 1 from public.group_members b where b.group_id = m.group_id and b.user_id = v_uid);
    update public.group_members m set user_id = v_uid
     where m.user_id = v_t.from_uid
       and not exists (select 1 from public.group_members b where b.group_id = m.group_id and b.user_id = v_uid);
    get diagnostics v_moved = row_count;
    select count(*) into v_skipped from public.group_members m where m.user_id = v_t.from_uid;
    update public.groups g set created_by = v_uid where g.created_by = v_t.from_uid;
  end if;
  update public.account_merge_tickets
     set used_at = now(), to_uid = v_uid, groups_moved = v_moved, groups_skipped = v_skipped
   where id = v_t.id;
  return jsonb_build_object('moved', v_moved, 'skipped', v_skipped, 'groups', v_names);
end;
$$;

revoke all on function public.account_merge_ticket() from public, anon;
revoke all on function public.account_merge_claim(text) from public, anon;
grant execute on function public.account_merge_ticket() to authenticated;
grant execute on function public.account_merge_claim(text) to authenticated;
