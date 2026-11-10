-- 0453 followups (ride → after, F1 step 6): "Kvällens chaufför" in the morning report comes from public.ride_awards (0420).
-- OWNER-RUN at release, AFTER 0420 (ride_awards) and 0450 (after_report2). Safe to run twice.
-- What changes in after_report2 (answer shape: only NEW keys, nothing renamed or left out):
--   people[].rides   finished Hämta mig rides of that person that night (ride_awards.n), 0 when none
--   people[].thanks  "Tack!" taps for those rides (ride_awards.thanks)
--   people[].driver  = (Jag kör ikväll that night OR rides > 0) AND NOT drank. Never for drinking: a person with a drink
--                    that night is never the driver, same rule as 0450.
--   A group member who drove people home but has no drink_log row and no "ute" (LÄSK! logs no drink) is added to
--   people as out = false (not in the counts, the route or the story; only the award). Ghost nights stay out.
-- Method (same as 0403 olnu_ub_patch): take the DEPLOYED definition, exact text replacements (each anchor must occur
-- exactly once, else it raises and nothing changes), then run the CREATE OR REPLACE. A definition that already reads
-- ride_awards is skipped. Signature, grants and security definer stay. No row-removing or object-removing statement.

do $fu$
declare
  v_fn  regprocedure := 'public.after_report2(uuid, timestamptz)';
  v_def text := pg_get_functiondef('public.after_report2(uuid, timestamptz)'::regprocedure);
  v_old text[];
  v_new text[];
  i int; n int;
begin
  if position('ride_awards' in v_def) > 0 then
    raise notice '0453: after_report2 already reads ride_awards, skip';
    return;
  end if;
  v_old := array[
    $a$'driver', p.driver and not p.drank, 'out', p.first_at is not null)$a$,
    $a$into v_people from public.olnu_after_people(v_gid, v_night) p;$a$
  ];
  v_new := array[
    $b$'driver', (p.driver or coalesce(ra.n, 0) > 0) and not p.drank,
           'rides', case when p.drank then 0 else coalesce(ra.n, 0) end, 'thanks', coalesce(ra.thanks, 0), 'out', p.first_at is not null)$b$,
    $b$into v_people from public.olnu_after_people(v_gid, v_night) p
    left join public.ride_awards ra on ra.user_id = p.user_id and ra.night = v_night;
  -- 0453: drivers who drove people home that night but are not in the list (no drink row, no "ute"): award only
  v_people := v_people || coalesce((select jsonb_agg(jsonb_build_object(
           'k', public.olnu_crew_k(v_gid, m.user_id), 'name', left(coalesce(m.display_name, ''), 40), 'is_me', m.user_id = v_uid,
           'first_at', null, 'last_at', null, 'first_place', null, 'bars', 0, 'said_ute', false, 'said_at', null,
           'home_at', null, 'skal', 0, 'driver', true, 'rides', ra.n, 'thanks', ra.thanks, 'out', false)
         order by m.joined_at)
      from public.group_members m
      join public.ride_awards ra on ra.user_id = m.user_id and ra.night = v_night and ra.n > 0
     where m.group_id = v_gid
       and not public.olnu_after_ghost(m.user_id, v_night)
       and not exists (select 1 from public.olnu_after_people(v_gid, v_night) x where x.user_id = m.user_id)
       and not exists (select 1 from public.drink_log d where d.user_id = m.user_id and d.night = v_night
                        and not d.undone and d.kind <> 'checkin')), '[]'::jsonb);$b$
  ];
  for i in 1 .. array_length(v_old, 1) loop
    n := (length(v_def) - length(replace(v_def, v_old[i], ''))) / greatest(length(v_old[i]), 1);
    if n <> 1 then
      raise exception '0453 after_report2: anchor % found % times (expected 1), nothing changed', i, n;
    end if;
    v_def := replace(v_def, v_old[i], v_new[i]);
  end loop;
  execute v_def;
  raise notice '0453: after_report2 patched (%)', v_fn::text;
end
$fu$;
