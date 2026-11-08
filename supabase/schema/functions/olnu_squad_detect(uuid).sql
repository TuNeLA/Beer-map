-- public.olnu_squad_detect(p_group uuid)
-- live md5(pg_get_functiondef) = d0a4d7684baaaf3643f8e3d313ebc302
CREATE OR REPLACE FUNCTION public.olnu_squad_detect(p_group uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_last timestamptz; a record; v_members uuid[]; v_n int; v_bar text; v_bname text;
  v_lat float8; v_lng float8; v_town text; g public.squad_gatherings; v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_squad:' || p_group::text, 0));
  select c.at into v_last from public.squad_checks c where c.group_id = p_group;
  if v_last is not null and v_last > now() - interval '20 seconds' then return null; end if;
  insert into public.squad_checks (group_id, at) values (p_group, now())
    on conflict (group_id) do update set at = now();

  select p1.uid, p1.lat, p1.lng, p1.at, count(*)::int as n into a
    from public.olnu_squad_pres(p_group) p1
    join public.olnu_squad_pres(p_group) p2 on public.olnu_dist_m(p1.lat, p1.lng, p2.lat, p2.lng) <= 50
   group by p1.uid, p1.lat, p1.lng, p1.at
   order by count(*) desc, p1.at desc
   limit 1;
  if a.uid is null or a.n < 3 then return null; end if;

  select array_agg(p.uid order by p.at), count(*)::int, avg(p.lat), avg(p.lng)
    into v_members, v_n, v_lat, v_lng
    from public.olnu_squad_pres(p_group) p
   where public.olnu_dist_m(a.lat, a.lng, p.lat, p.lng) <= 50;
  select p.bar_id, max(p.bar_name) into v_bar, v_bname
    from public.olnu_squad_pres(p_group) p
   where public.olnu_dist_m(a.lat, a.lng, p.lat, p.lng) <= 50 and p.bar_id is not null
   group by p.bar_id order by count(*) desc, max(p.at) desc limit 1;
  v_lat := round(v_lat::numeric, 4)::float8; v_lng := round(v_lng::numeric, 4)::float8;
  if v_bar is null or v_bname is null then v_bar := null; v_town := public.olnu_town_of(v_lat, v_lng); end if;

  select * into g from public.squad_gatherings x
   where x.group_id = p_group and x.created_at > now() - interval '90 minutes'
     and ((v_bar is not null and x.bar_id = v_bar) or public.olnu_dist_m(x.lat, x.lng, v_lat, v_lng) <= 150)
   order by x.created_at desc limit 1;
  if g.id is not null then
    update public.squad_gatherings x
       set n = greatest(x.n, v_n),
           members = array(select distinct u from unnest(x.members || v_members) u),
           updated_at = now()
     where x.id = g.id;
    return null;
  end if;
  insert into public.squad_gatherings (group_id, night, bar_id, place_name, place_kind, lat, lng, n, members)
  values (p_group, public.olnu_night_of(now()), v_bar, coalesce(v_bname, v_town),
          case when v_bar is not null then 'bar' when v_town is not null then 'town' else 'none' end,
          v_lat, v_lng, v_n, v_members)
  returning id into v_id;
  return v_id;
end; $function$;
