-- public.bar_areas_in(p_s double precision, p_w double precision, p_n double precision, p_e double precision)
-- live md5(pg_get_functiondef) = 23c30571f83056f67a928a5f7ebca401
CREATE OR REPLACE FUNCTION public.bar_areas_in(p_s double precision, p_w double precision, p_n double precision, p_e double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  if p_s is null or p_w is null or p_n is null or p_e is null or p_n < p_s or p_e < p_w
     or p_n - p_s > 0.5 or p_e - p_w > 1.0 then
    raise exception 'invalid_box';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'bar_id', a.bar_id, 'polygon', a.polygon, 'area_m2', a.area_m2,
             'status', a.status, 'mine', a.created_by = v_uid) order by a.id)
    from (select * from public.bar_areas x
           where x.superseded_at is null and x.bar_lat between p_s and p_n and x.bar_lng between p_w and p_e
             and (x.status = 'ok' or (x.status = 'pending' and x.created_by = v_uid))
           order by x.id desc limit 500) a), '[]'::jsonb);
end; $function$;
