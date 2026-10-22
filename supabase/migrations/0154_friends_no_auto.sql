-- 0154 friends2: group membership no longer makes people friends (owner 2026-10-22).
-- Before: friend_list / the Vänner tab showed accepted friendships PLUS everyone who shares a group, and a group-mate
-- could not be taken off the list. Now: one-time backfill so nobody loses a friend today, then only rows in
-- public.friendships with status 'accepted' are friends. Group features keep working on group membership.
-- 1. Backfill: every pair that shares a real group (group_members; temp / DM groups have no members) and has no
--    friendship row gets an accepted row (via 'group', notified = true = no push). A pending row between such a pair is
--    accepted (they were shown as friends already). Rows that are declined / removed / cancelled stay as they are.
--    Pairs with a test user (0149, Kiruna test zone) are skipped.
-- 2. Trigger friendships_end_share: when an accepted friendship ends, live find requests made through that friendship
--    end and the exact find positions between the two people expire (friend-only sharing stops at once).
-- Additive: no table or function is removed. Needs 0045 / 0047 (friendships, find_reqs, find_pos), 0149.

insert into public.friendships (a, b, requester, status, via, created_at, updated_at, accepted_at, notified)
select p.a, p.b, p.a, 'accepted', 'group', now(), now(), now(), true
  from (select distinct least(m1.user_id, m2.user_id) as a, greatest(m1.user_id, m2.user_id) as b
          from public.group_members m1
          join public.group_members m2 on m2.group_id = m1.group_id and m2.user_id <> m1.user_id) p
 where not public.olnu_is_test_user(p.a) and not public.olnu_is_test_user(p.b)
   and not exists (select 1 from public.friendships f
                    where least(f.a, f.b) = p.a and greatest(f.a, f.b) = p.b);

update public.friendships f
   set status = 'accepted', accepted_at = now(), updated_at = now(), notified = true
 where f.status = 'pending'
   and exists (select 1 from public.group_members m1
                 join public.group_members m2 on m2.group_id = m1.group_id
                where m1.user_id = f.a and m2.user_id = f.b)
   and not public.olnu_is_test_user(f.a) and not public.olnu_is_test_user(f.b);

create or replace function public.olnu_friend_end_tg()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if old.status = 'accepted' and new.status <> 'accepted' then
    update public.find_reqs r
       set status = case when r.status = 'pending' then 'cancelled' else r.status end,
           answer_by = least(r.answer_by, now()),
           until = case when r.until is null then null else least(r.until, now()) end
     where r.friendship_id = new.id
       and (r.answer_by > now() or r.until > now());
    update public.find_pos fp
       set expires_at = least(fp.expires_at, now())
     where ((fp.user_id = new.a and fp.target_uid = new.b) or (fp.user_id = new.b and fp.target_uid = new.a))
       and fp.expires_at > now();
  end if;
  return new;
end $$;
revoke all on function public.olnu_friend_end_tg() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_friend_end_tg() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.olnu_friend_end_tg() from authenticated';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'friendships_end_share' and tgrelid = 'public.friendships'::regclass) then
    execute 'create trigger friendships_end_share after update of status on public.friendships
               for each row execute function public.olnu_friend_end_tg()';
  end if;
end $$;
