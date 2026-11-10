-- 0403 MISC · BLOCKED PEOPLE NEVER SEE EACH OTHER (X5): groups, chat lists, map check-ins, ETAs, film. OWNER-RUN at release.
-- 0206 already hides a blocked person (both ways) in group_msgs / group_photos / group_voices / avatars_for / olnu_pins
-- (map pins). These reads did NOT check user_blocks (checked on live 10 Nov, same definitions on staging):
--   group_status_v2 (member list on the group page; group_status_v3 reads it) · group_status (old) · group_now
--   ("Ute ikväll" on the group page) · ikvall_status · my_dms (DM list) · film_roll · film_photo · film_story ·
--   poll_v2 check-ins (names on the map) · live_checkins (old map) · group_etas ("på väg" on the map).
-- Method (same as 0149 olnu_tz_patch): olnu_ub_patch() takes the DEPLOYED definition, makes exact text replacements
-- (each anchor must occur exactly once, else it raises and nothing changes), and runs the CREATE OR REPLACE.
-- A definition that already calls olnu_ub_hidden is skipped (safe to run twice). Signatures, grants and answer shapes
-- stay the same. Only one filter is added: not olnu_ub_hidden(viewer, person). With no active block between the two
-- people it is true, so the answer is the same as before (tested in supabase/tests/misc.staging.test.sql).
-- No row-removing or object-removing statement in this file.

create or replace function public.olnu_ub_patch(p_fn regprocedure, p_old text[], p_new text[])
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_def text := pg_get_functiondef(p_fn);
  i int; n int;
begin
  if position('olnu_ub_hidden' in v_def) > 0 then return 'skip ' || p_fn::text; end if;
  for i in 1 .. coalesce(array_length(p_old, 1), 0) loop
    n := (length(v_def) - length(replace(v_def, p_old[i], ''))) / greatest(length(p_old[i]), 1);
    if n <> 1 then
      raise exception 'olnu_ub_patch %: anchor % found % times', p_fn::text, i, n;
    end if;
    v_def := replace(v_def, p_old[i], p_new[i]);
  end loop;
  execute v_def;
  return 'ok ' || p_fn::text;
end $$;
revoke all on function public.olnu_ub_patch(regprocedure, text[], text[]) from public, anon, authenticated;

-- 1. Groups: the member list (group page, Gänget, Medlemmar; v3 = v2 + meriter).
select public.olnu_ub_patch('public.group_status_v2(uuid)',
  array['where gm.group_id = p_group_id'],
  array['where gm.group_id = p_group_id and not public.olnu_ub_hidden(v_uid, gm.user_id)']);

select public.olnu_ub_patch('public.group_status(uuid)',
  array['where gm.group_id = p_group_id'],
  array['where gm.group_id = p_group_id and not public.olnu_ub_hidden(v_uid, gm.user_id)']);

-- 2. Group page "Ute ikväll" + the newest event line.
select public.olnu_ub_patch('public.group_now(uuid)',
  array['select gm.user_id, gm.display_name from public.group_members gm where gm.group_id = p_group_id',
        'where m.group_id = p_group_id and c.expires_at > now()',
        'where m.group_id = p_group_id and b.expires_at > now()'],
  array['select gm.user_id, gm.display_name from public.group_members gm where gm.group_id = p_group_id and not public.olnu_ub_hidden(v_uid, gm.user_id)',
        'where m.group_id = p_group_id and c.expires_at > now() and not public.olnu_ub_hidden(v_uid, m.user_id)',
        'where m.group_id = p_group_id and b.expires_at > now() and not public.olnu_ub_hidden(v_uid, m.user_id)']);

-- 3. Ikväll? (who says ute / kanske / hemma).
select public.olnu_ub_patch('public.ikvall_status(uuid)',
  array['join public.ikvall_status s on s.user_id = p.uid and s.night = v_night'],
  array['join public.ikvall_status s on s.user_id = p.uid and s.night = v_night and not public.olnu_ub_hidden(v_uid, p.uid)']);

-- 4. The DM list (Meddelanden): a thread with a blocked person is gone for both.
select public.olnu_ub_patch('public.my_dms()',
  array['from public.dm_threads d where d.a = v_uid or d.b = v_uid'],
  array['from public.dm_threads d where (d.a = v_uid or d.b = v_uid) and not public.olnu_ub_hidden(v_uid, case when d.a = v_uid then d.b else d.a end)']);

-- 5. Film (engångskameran): the roll, one photo, the Morgontidningen strip.
select public.olnu_ub_patch('public.film_roll(uuid, timestamp with time zone)',
  array[$a$and m.user_id = sp.user_id)), '[]'::jsonb));$a$],
  array[$a$and m.user_id = sp.user_id)
                           and not public.olnu_ub_hidden(v_uid, sp.user_id)), '[]'::jsonb));$a$]);

select public.olnu_ub_patch('public.film_photo(bigint)',
  array[$a$if not found then raise exception 'photo_not_found'; end if;$a$],
  array[$a$if not found or public.olnu_ub_hidden(v_uid, v_row.user_id) then raise exception 'photo_not_found'; end if;$a$]);

select public.olnu_ub_patch('public.film_story(uuid, date)',
  array['join public.group_members m on m.group_id = p_group_id and m.user_id = sp.user_id'],
  array['join public.group_members m on m.group_id = p_group_id and m.user_id = sp.user_id and not public.olnu_ub_hidden(v_uid, sp.user_id)']);

-- 6. Map: check-ins (poll_v2 + the old live_checkins) and ETAs ("på väg"). Pins: already in olnu_pins (0206).
select public.olnu_ub_patch('public.poll_v2(double precision, double precision, double precision, double precision, timestamp with time zone, boolean)',
  array['where c.user_id = v_uid or f.fname is not null',
        'or (c.lat between v_a and v_c and c.lng between v_b and v_d)),'],
  array['where not public.olnu_ub_hidden(v_uid, c.user_id) and (c.user_id = v_uid or f.fname is not null',
        'or (c.lat between v_a and v_c and c.lng between v_b and v_d))),']);

select public.olnu_ub_patch('public.live_checkins()',
  array['where c.expires_at > now() and ('],
  array['where c.expires_at > now() and not public.olnu_ub_hidden(v_uid, c.user_id) and (']);

select public.olnu_ub_patch('public.group_etas()',
  array['where e.expires_at > now() and e.cancelled_at is null'],
  array['where e.expires_at > now() and e.cancelled_at is null and not public.olnu_ub_hidden(v_uid, e.user_id)']);
