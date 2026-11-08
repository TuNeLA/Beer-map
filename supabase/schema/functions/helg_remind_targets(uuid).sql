-- public.helg_remind_targets(p_caller uuid)
-- live md5(pg_get_functiondef) = 35c349f5a4377d70d8f9ab171ff9d979
CREATE OR REPLACE FUNCTION public.helg_remind_targets(p_caller uuid)
 RETURNS TABLE(user_id uuid, streak integer, name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := public.olnu_helg_now();
  v_loc timestamp := v_now at time zone 'Europe/Stockholm';
  v_week date := public.olnu_helg_week(v_now);
  v_key timestamptz := (v_week::timestamp) at time zone 'Europe/Stockholm';
  r record;
  v_c jsonb;
  v_ok int;
begin
  if extract(isodow from v_loc) <> 5 or extract(hour from v_loc) < 17 then return; end if;
  for r in select distinct m2.user_id as uid
             from public.group_members m1 join public.group_members m2 on m2.group_id = m1.group_id
            where m1.user_id = p_caller and m2.user_id <> p_caller loop
    if exists (select 1 from public.push_sent ps where ps.user_id = r.uid and ps.kind = 'helg' and ps.night = v_key) then
      continue;
    end if;
    v_c := public.olnu_helg_calc(r.uid, v_now);
    if coalesce((v_c->>'at_risk')::boolean, false) and (v_c->>'streak')::int >= 1 then
      insert into public.push_sent (user_id, kind, night) values (r.uid, 'helg', v_key) on conflict do nothing;
      get diagnostics v_ok = row_count;
      if v_ok > 0 then
        user_id := r.uid; streak := (v_c->>'streak')::int;
        select gm.display_name into name from public.group_members gm where gm.user_id = r.uid order by gm.joined_at limit 1;
        return next;
      end if;
    end if;
  end loop;
end;
$function$;
