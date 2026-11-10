-- 0431 SEC (X3) · BLOCKED PEOPLE NEVER SEE EACH OTHER — the reads 0403 did not cover. OWNER-RUN at release.
-- Run order: AFTER 0403 and 0430 (it uses olnu_ub_hidden from 0400 and olnu_sec_patch from 0430).
-- Verified on staging 10 Nov (scratchpad/sec/REPORT.md, scan mode "blocked"): after V blocks K (both in one group),
-- K still got V's name, "out" state, current bar, rallies (with the meeting point) and chat lines from these reads,
-- and K could still send V a friend request through the group. Same method as 0403/0430: exact text patches of the
-- deployed definitions; a missing anchor raises and changes nothing; a patched definition (marker /*sec0431*/) is
-- skipped, so the file is safe to run twice. With no active block between two people, olnu_ub_hidden is false, so
-- every answer is the same as before.
-- Not changed on purpose: rnd_group (Swish/split money: the debt list must stay complete), the chief role name
-- (chief_name / chief_k in olnu_chief_json), and aggregate counts.
-- No row-removing or object-removing statement in this file.

-- 1. Gänget / crew page (crew_group, olnu_crew_group_json): members with state "out" + current bar + position.
select public.olnu_sec_patch('public.olnu_crew_members(uuid, uuid)', '/*sec0431*/',
  array['select gm.user_id, gm.display_name, gm.joined_at from public.group_members gm where gm.group_id = p_group'],
  array['select gm.user_id, gm.display_name, gm.joined_at from public.group_members gm where gm.group_id = p_group and not public.olnu_ub_hidden(p_viewer, gm.user_id) /*sec0431*/']);

-- 2. Rallies (poll_v2 rallies on the map, group_rallies, my_rallies, my_inbox): the rally and the "yes" names.
select public.olnu_sec_patch('public.olnu_rally_rows(uuid, uuid)', '/*sec0431*/',
  array['   where r.expires_at > now() and not r.closed',
        '       where a.rally_id = r.id
    ) c on true'],
  array['   where r.expires_at > now() and not r.closed and not public.olnu_ub_hidden(p_uid, r.user_id) /*sec0431*/',
        '       where a.rally_id = r.id and not public.olnu_ub_hidden(p_uid, a.user_id)
    ) c on true']);

-- 3. Friend state per group member (Medlemmar: "lägg till vän").
select public.olnu_sec_patch('public.group_friend_states(uuid)', '/*sec0431*/',
  array['where m.group_id = p_group_id and m.user_id <> v_uid'],
  array['where m.group_id = p_group_id and m.user_id <> v_uid and not public.olnu_ub_hidden(v_uid, m.user_id) /*sec0431*/']);

-- 4. Hemma? (home_status): who is out / home tonight.
select public.olnu_sec_patch('public.home_status(boolean)', '/*sec0431*/',
  array['   where me.user_id = v_uid
   order by g.name'],
  array['   where me.user_id = v_uid and not public.olnu_ub_hidden(v_uid, gm.user_id) /*sec0431*/
   order by g.name']);

-- 5. Befäl (chief_state → olnu_chief_json): the member list with home town.
select public.olnu_sec_patch('public.olnu_chief_json(uuid, uuid)', '/*sec0431*/',
  array['      from public.group_members m where m.group_id = p_group
  )'],
  array['      from public.group_members m where m.group_id = p_group and not public.olnu_ub_hidden(p_uid, m.user_id) /*sec0431*/
  )']);

-- 6. Vänner list + suggestions (friend_list): a blocked person is not listed (also not as "out" tonight).
select public.olnu_sec_patch('public.friend_list(text)', '/*sec0431*/',
  array['where x.uid is not null and x.uid <> v_uid limit 400'],
  array['where x.uid is not null and x.uid <> v_uid and not public.olnu_ub_hidden(v_uid, x.uid) /*sec0431*/ limit 400']);

-- 7. Friend request to a person who blocked me (or whom I blocked): refused like an unknown code.
select public.olnu_sec_patch('public.friend_request(text, uuid, text, text)', '/*sec0431*/',
  array['if v_t = v_uid then raise exception ''own_code''; end if;'],
  array['if v_t = v_uid then raise exception ''own_code''; end if;
  if public.olnu_ub_hidden(v_uid, v_t) then raise exception ''friend_not_found''; end if; /*sec0431*/']);

-- 8. Kvällens story (group_night_story): members, check-ins + arrivals, rallies, top chat lines, photos.
select public.olnu_sec_patch('public.group_night_story(uuid, date)', '/*sec0431*/',
  array['into v_uids from public.group_members m where m.group_id = p_group_id;',
        'left join ci on ci.k = public.olnu_gang_k(p_group_id, m.user_id)
   where m.group_id = p_group_id;',
        'from (select * from public.rallies x where x.group_id = p_group_id and x.created_at >= v_start',
        'where gm.group_id = p_group_id and gm.created_at >= v_start and gm.created_at < v_end',
        'where cp.group_id = p_group_id and cp.created_at >= v_start and cp.created_at < v_end and cp.bytes is not null',
        '             where t.kind = ''ci'' and t.night = v_end'],
  array['into v_uids from public.group_members m where m.group_id = p_group_id and not public.olnu_ub_hidden(v_uid, m.user_id); /*sec0431*/',
        'left join ci on ci.k = public.olnu_gang_k(p_group_id, m.user_id)
   where m.group_id = p_group_id and not public.olnu_ub_hidden(v_uid, m.user_id);',
        'from (select * from public.rallies x where x.group_id = p_group_id and not public.olnu_ub_hidden(v_uid, x.user_id) and x.created_at >= v_start',
        'where gm.group_id = p_group_id and not public.olnu_ub_hidden(v_uid, gm.user_id) and gm.created_at >= v_start and gm.created_at < v_end',
        'where cp.group_id = p_group_id and not public.olnu_ub_hidden(v_uid, cp.user_id) and cp.created_at >= v_start and cp.created_at < v_end and cp.bytes is not null',
        '             where t.kind = ''ci'' and t.night = v_end and not public.olnu_ub_hidden(v_uid, t.user_id)']);

-- 9. Bar photos from my groups (bar sheet): photos by a blocked person.
select public.olnu_sec_patch('public.bar_photos(text)', '/*sec0431*/',
  array['and exists (select 1 from public.group_members m where m.group_id = p.group_id and m.user_id = v_uid)'],
  array['and exists (select 1 from public.group_members m where m.group_id = p.group_id and m.user_id = v_uid) and not public.olnu_ub_hidden(v_uid, p.user_id) /*sec0431*/']);

-- 10. Who reacted / liked (names under a chat line).
select public.olnu_sec_patch('public.msg_reacts(uuid)', '/*sec0431*/',
  array['   where r.active
   group by r.msg_id, r.emoji;'],
  array['   where r.active and not public.olnu_ub_hidden(v_uid, r.user_id) /*sec0431*/
   group by r.msg_id, r.emoji;']);

select public.olnu_sec_patch('public.msg_likes(uuid)', '/*sec0431*/',
  array['   where l.liked
   group by l.msg_id;'],
  array['   where l.liked and not public.olnu_ub_hidden(v_uid, l.user_id) /*sec0431*/
   group by l.msg_id;']);

-- 11. Medals per member (Medlemmar).
select public.olnu_sec_patch('public.member_medals(uuid)', '/*sec0431*/',
  array['   where gm.group_id = p_group_id
   order by gm.display_name, um.earned_at, um.medal'],
  array['   where gm.group_id = p_group_id and not public.olnu_ub_hidden(v_uid, gm.user_id) /*sec0431*/
   order by gm.display_name, um.earned_at, um.medal']);

-- 12. Gängkväll + Morgontidningen member lists, and the game member list (with "out").
select public.olnu_sec_patch('public.gang_group(uuid)', '/*sec0431*/',
  array['from public.group_members m where m.group_id = p_group_id),'],
  array['from public.group_members m where m.group_id = p_group_id and not public.olnu_ub_hidden(v_uid, m.user_id) /*sec0431*/),']);

select public.olnu_sec_patch('public.gang_paper(uuid, timestamp with time zone)', '/*sec0431*/',
  array['select m.user_id, m.display_name from public.group_members m where m.group_id = p_group_id'],
  array['select m.user_id, m.display_name from public.group_members m where m.group_id = p_group_id and not public.olnu_ub_hidden(v_uid, m.user_id) /*sec0431*/']);

select public.olnu_sec_patch('public.olnu_g_group(uuid, uuid, timestamp with time zone, boolean, integer)', '/*sec0431*/',
  array['      into v_j from public.group_members m where m.group_id = p_group;
    v_out := v_out || jsonb_build_object(''members'', v_j);'],
  array['      into v_j from public.group_members m where m.group_id = p_group and not public.olnu_ub_hidden(p_uid, m.user_id) /*sec0431*/;
    v_out := v_out || jsonb_build_object(''members'', v_j);']);
