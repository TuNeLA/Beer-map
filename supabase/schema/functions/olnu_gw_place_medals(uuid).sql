-- public.olnu_gw_place_medals(p_uid uuid)
-- live md5(pg_get_functiondef) = 32c5183ebd60dfe88612aed09abe7edc
CREATE OR REPLACE FUNCTION public.olnu_gw_place_medals(p_uid uuid)
 RETURNS TABLE(medal text, n integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_bars int; v_full int; v_dal int;
begin
  select count(*)::int into v_bars from public.olnu_gw_my_bars(p_uid) b where b.lat is not null or b.name is not null;
  select count(*) filter (where p.total >= 2 and p.visited >= p.total)::int, count(*) filter (where p.dalarna)::int
    into v_full, v_dal from public.olnu_gw_town_progress(p_uid) p;
  medal := 'pl_ny'; n := coalesce(v_bars, 0); return next;
  medal := 'pl_stad'; n := coalesce(v_full, 0); return next;
  medal := 'pl_dalarna'; n := case when coalesce(v_dal, 0) >= 3 then 1 else 0 end; return next;
end $function$;
