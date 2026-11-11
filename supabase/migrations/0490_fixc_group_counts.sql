-- 0490 fixC (test teams round 2, N-17) · GROUP COUNTS WITHOUT BLOCKED PEOPLE. OWNER-RUN at release, AFTER 0403 and
-- 0430/0431 (uses olnu_sec_patch from 0430 and olnu_ub_hidden from 0400/0403).
-- Found on staging 11 Nov: the Grupper list (my_groups) said "1 av 4 dricker nu" while the group page said "0 av 4":
--   * my_groups counted a person the caller blocked (or who blocked the caller) as member and as "dricker nu";
--   * my_groups counted every live pin as "dricker nu" (also a ghost pin and a pin with 0 drinks); group_now does not.
--   * group_now 'members' counted the blocked person too (the member strip on the page does not show them).
-- Method (same as 0403/0430/0431): olnu_sec_patch() takes the DEPLOYED definition, makes exact text replacements (each
-- anchor exactly once, else it raises and nothing changes) and runs the CREATE OR REPLACE. Marker /*fixc0490*/: a 2nd run
-- = "skip". Signatures, grants and answer shapes stay the same. With no block and no ghost pin the answer is the same.
-- No row-removing or object-removing statement in this file.

-- 1. Grupper list: member_count + active_count (the same "out" rule as group_now: live, not stopped, not ghost, ≥ 1 drink).
select public.olnu_sec_patch('public.my_groups()', '/*fixc0490*/',
  array['(select count(*)::int from public.group_members m where m.group_id = g.id),',
        'join public.beers b on b.user_id = m.user_id and b.expires_at > now() and not b.stopped'],
  array['(select count(*)::int from public.group_members m where m.group_id = g.id and not public.olnu_ub_hidden(v_uid, m.user_id)) /*fixc0490*/,',
        'join public.beers b on b.user_id = m.user_id and b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false) and coalesce(b.beer_count, 0) + coalesce(b.other_count, 0) > 0 and not public.olnu_ub_hidden(v_uid, m.user_id)']);

-- 2. Group page: group_now 'members' (the "N av M" line and "N medlemmar").
select public.olnu_sec_patch('public.group_now(uuid)', '/*fixc0490*/',
  array['select count(*)::int into v_n from public.group_members m where m.group_id = p_group_id;'],
  array['select count(*)::int into v_n from public.group_members m where m.group_id = p_group_id and not public.olnu_ub_hidden(v_uid, m.user_id); /*fixc0490*/']);
