-- public.group_etas()
-- live md5(pg_get_functiondef) = 11e45d1a9e916699bfffd0fad0a6363d
CREATE OR REPLACE FUNCTION public.group_etas()
 RETURNS TABLE(id bigint, name text, is_me boolean, bar_id text, bar_name text, lat double precision, lng double precision, rally_id bigint, minutes integer, eta_at timestamp with time zone, mins_left integer, created_at timestamp with time zone, arrived boolean, arrived_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  with mine as (select m.group_id, m.display_name from public.group_members m where m.user_id = v_uid)
  select e.id,
         case
           when e.user_id = v_uid then (select min(x.display_name) from mine x)
           when e.group_id is not null then (select gm.display_name from public.group_members gm
                                              where gm.group_id = e.group_id and gm.user_id = e.user_id)
           else (select min(gm.display_name) from public.group_members gm
                  where gm.user_id = e.user_id and gm.group_id in (select x.group_id from mine x))
         end::text,
         e.user_id = v_uid, e.bar_id, e.bar_name, e.lat, e.lng, e.rally_id, e.minutes, e.eta_at,
         greatest(0, ceil(extract(epoch from (e.eta_at - now())) / 60.0))::int, e.created_at,
         e.arrived_at is not null, e.arrived_at
    from public.etas e
   where e.expires_at > now() and e.cancelled_at is null
     and (public.olnu_eta_live(e) or (e.arrived_at > now() - interval '15 minutes' and public.olnu_eta_rally_ok(e)))
     and (
       e.user_id = v_uid
       or (e.group_id is null and exists (
             select 1 from public.group_members gm
              where gm.user_id = e.user_id and gm.group_id in (select x.group_id from mine x)))
       or (e.group_id is not null
           and e.group_id in (select x.group_id from mine x)
           and exists (select 1 from public.group_members gm where gm.group_id = e.group_id and gm.user_id = e.user_id))
     )
   order by e.eta_at
   limit 300;
end; $function$;
