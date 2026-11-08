-- public.olnu_aio_price(p_bar_id text, p_kind text)
-- live md5(pg_get_functiondef) = d7a3b55edc81ff51c550dd9edf7e17ec
CREATE OR REPLACE FUNCTION public.olnu_aio_price(p_bar_id text, p_kind text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with per_user as (
    select distinct on (p.user_id) p.kr, p.updated_at
      from public.bar_prices p
     where p.bar_id = p_bar_id and p.kind = p_kind and p.updated_at > now() - interval '120 days'
     order by p.user_id, p.updated_at desc
  ), recent as (select * from per_user order by updated_at desc limit 7)
  select case when count(*) = 0 then null else
    jsonb_build_object('kr', round(percentile_cont(0.5) within group (order by kr))::int, 'n', count(*), 'at', max(updated_at)) end
    from recent;
$function$;
