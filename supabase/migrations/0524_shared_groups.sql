-- 0524 · poll_v2 pins get shared_groups: the groups that the caller AND that person are both in (lane folkhar, I-120 / I-122). OWNER-RUN. Staging first.
-- A3-EXCEPTION: poll_v2 is not the same text on live (before 0465) and in the release model (see 0523). So the change is one exact
-- anchored patch (marker /*sg524*/, olnu_sec_patch: the anchor must be found exactly once, else it stops) that lands on both models.
-- Check after the run (expect t, t, f, f):
--   select position('/*sg524*/' in pg_get_functiondef('public.poll_v2(double precision, double precision, double precision, double precision, timestamp with time zone, boolean)'::regprocedure)) > 0,
--     to_regprocedure('public.olnu_s524_shared(uuid, bigint)') is not null,
--     has_function_privilege('anon', 'public.olnu_s524_shared(uuid, bigint)', 'execute'),
--     has_function_privilege('authenticated', 'public.olnu_s524_shared(uuid, bigint)', 'execute');
--
-- Why: the owner wants a group label under each named face in "Folk här" (a dot + the group name). The client cannot know
-- which groups two people share (it only knows its own groups). Matching names in the client is weak (two people can
-- have the same name). So the server says it, for the caller only.
-- What changes: each poll_v2 pin of a group mate (is_friend) gets 'shared_groups' = [{id, name}, ...]: only the groups
--   that auth.uid() is in AND the pin owner is in, sorted by name. Never other groups. My own pin and a stranger's pin
--   get no shared_groups key at all (json_strip_nulls leaves out the null). The client gets the colour from the id (GPAGE.colorOf).
--   live_beers (the old-server path) is not changed: a new column would change its result type. The client then shows "Vän".
-- Functions changed (snapshot this first = the rollback): poll_v2(double precision ×4, timestamp with time zone, boolean)
--   [anchored: 1 line, a new line after 'friend_name'].
-- New: function olnu_s524_shared(uuid, bigint) (internal, no grant to public / anon / authenticated).
-- Additive. Safe to run twice. CR LF safe. Needs: olnu_sec_patch (0430/0436), olnu_strip_cr (0436).

-- The groups that p_uid and the owner of beer p_beer_id are both in, as [{id, name}] sorted by name; null when none.
create or replace function public.olnu_s524_shared(p_uid uuid, p_beer_id bigint)
returns json language sql stable set search_path = public as $$
  select json_agg(json_build_object('id', g.id, 'name', g.name) order by lower(g.name), g.id)
    from public.beers b
    join public.group_members om on om.user_id = b.user_id
    join public.group_members mm on mm.group_id = om.group_id and mm.user_id = p_uid
    join public.groups g on g.id = om.group_id
   where b.id = p_beer_id and p_uid is not null and b.user_id <> p_uid;
$$;
revoke all on function public.olnu_s524_shared(uuid, bigint) from public, anon, authenticated;

select public.olnu_sec_patch('public.poll_v2(double precision, double precision, double precision, double precision, timestamp with time zone, boolean)', '/*sg524*/',
  array[$a$'friend_name', case when sel.is_mine then null else sel.friend_name end,$a$],
  array[$a$'friend_name', case when sel.is_mine then null else sel.friend_name end,
           'shared_groups', case when sel.is_friend then public.olnu_s524_shared(v_uid, sel.beer_id) end, /*sg524*/$a$]);

select public.olnu_strip_cr();
