-- 0470 fixS (test teams T-01) · A FULL BLOCK REALLY HIDES — the reads 0403/0431 did not cover. OWNER-RUN at release.
-- Run order: AFTER 0430 and 0431 (it uses olnu_sec_patch from 0430 and olnu_ub_hidden from 0206/0400).
-- Found by the test teams 11 Nov on staging (night3 N3-02) and by reading the deployed definitions on staging:
--   1. "Du kanske känner" (friend_suggest → olnu_sug_rows2) has no block filter: a blocked group mate or a
--      friend-of-a-friend could still be suggested (with "1 gemensam vän").
--   2. Mina vänner (my_friends): no block filter (block_user ends the friendship, but a block made another way, or an
--      incoming request from before, could still list the person).
--   3. A DM thread (olnu_dm_json) knows only the DM-only block (dm_blocks): after a full block from the chat menu, the
--      friend row or a member card, the blocker was shown the blocked person's text. New key full_block for the client.
--   4. Inställningar → Blockerade → Häv (unblock_user) left the DM-only row on → the chat stayed closed.
-- Same method as 0403/0430/0431: exact text patches of the deployed definitions; a missing anchor raises and changes
-- nothing; a patched definition (marker /*fixs0470*/) is skipped, so the file is safe to run twice. With no active
-- block between two people, olnu_ub_hidden is false and no user_blocks row exists, so every answer is the same as before.
-- Additive only: no row or object is removed by this file.

-- 1. Du kanske känner: never suggest a person I blocked or who blocked me.
select public.olnu_sec_patch('public.olnu_sug_rows2(uuid)', '/*fixs0470*/',
  array[$a$and public.olnu_friend_name(c.uid) is not null$a$],
  array[$a$and public.olnu_friend_name(c.uid) is not null and not public.olnu_ub_hidden(p_uid, c.uid) /*fixs0470*/$a$]);

-- 2. Mina vänner: friends and incoming requests without blocked people.
select public.olnu_sec_patch('public.my_friends(text)', '/*fixs0470*/',
  array[$a$cross join lateral (select public.olnu_friend_other(f, v_uid) as uid) o$a$,
        $a$and f.status = 'pending' and f.requester <> v_uid;$a$],
  array[$a$cross join lateral (select public.olnu_friend_other(f, v_uid) as uid) o
      join lateral (select 1 as one) ubx on not public.olnu_ub_hidden(v_uid, o.uid) /*fixs0470*/$a$,
        $a$and f.status = 'pending' and f.requester <> v_uid and not public.olnu_ub_hidden(v_uid, f.requester);$a$]);

-- 3. DM thread state: a full block (user_blocks) counts as "blocked by me" / "blocked me"; full_block tells the client
--    which text and which undo to show ("Avblockera" = the full undo, "Öppna chatten igen" = only the DM-only block).
select public.olnu_sec_patch('public.olnu_dm_json(uuid, uuid)', '/*fixs0470*/',
  array[$a$'blocked_by_me', exists (select 1 from public.dm_blocks k where k.blocker = p_uid and k.blocked = v_o and k.active),$a$,
        $a$'blocked_me', exists (select 1 from public.dm_blocks k where k.blocker = v_o and k.blocked = p_uid and k.active),$a$],
  array[$a$'blocked_by_me', exists (select 1 from public.dm_blocks k where k.blocker = p_uid and k.blocked = v_o and k.active)
                     or exists (select 1 from public.user_blocks u where u.blocker = p_uid and u.blocked = v_o and u.active),
    'full_block', exists (select 1 from public.user_blocks u where u.blocker = p_uid and u.blocked = v_o and u.active), /*fixs0470*/$a$,
        $a$'blocked_me', exists (select 1 from public.dm_blocks k where k.blocker = v_o and k.blocked = p_uid and k.active)
                  or exists (select 1 from public.user_blocks u where u.blocker = v_o and u.blocked = p_uid and u.active),$a$]);

-- 4. Häv (Inställningar → Blockerade): also open the DM-only block for the same person, so the chat works again.
select public.olnu_sec_patch('public.unblock_user(text)', '/*fixs0470*/',
  array[$a$if n = 0 then raise exception 'not_found'; end if;$a$],
  array[$a$update public.dm_blocks d set active = false, updated_at = now()
   where d.blocker = v_uid and d.active and substr(md5(d.blocker::text || ':' || d.blocked::text || ':olnu-ub'), 1, 16) = p_id; /*fixs0470*/
  if n = 0 then raise exception 'not_found'; end if;$a$]);
