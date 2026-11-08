-- public.bar_prices_in(p_s double precision, p_w double precision, p_n double precision, p_e double precision)
-- live md5(pg_get_functiondef) = 9d6587f82c5d19c5fc7f2ae7e3e77457
CREATE OR REPLACE FUNCTION public.bar_prices_in(p_s double precision, p_w double precision, p_n double precision, p_e double precision)
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
  return coalesce((select jsonb_agg(jsonb_build_object('bar_id', b.bar_id) || public.olnu_aio_price(b.bar_id, 'stor'))
    from (select distinct p.bar_id from public.bar_prices p
           where p.kind = 'stor' and p.bar_lat between p_s and p_n and p.bar_lng between p_w and p_e
             and p.updated_at > now() - interval '120 days'
           limit 400) b), '[]'::jsonb);
end; $function$;
