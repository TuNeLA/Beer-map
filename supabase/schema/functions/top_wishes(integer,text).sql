-- public.top_wishes(p_limit integer, p_category text)
-- live md5(pg_get_functiondef) = d049475e4ff091291b4f40a3288d78e9
CREATE OR REPLACE FUNCTION public.top_wishes(p_limit integer DEFAULT 30, p_category text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, body text, category text, name text, votes integer, status text, created_at timestamp with time zone, mine boolean, is_mine boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_cat text := nullif(lower(btrim(coalesce(p_category, ''))), '');
begin
  return query
  select w.id, w.body, w.category, w.name, w.votes, w.status, w.created_at,
         exists (select 1 from public.wish_votes v where v.wish_id = w.id and v.user_id = v_uid and v.active),
         w.user_id = v_uid
    from public.feature_wishes w
   where (w.status <> 'dold' or w.user_id = v_uid)
     and (v_cat is null or w.category = v_cat)
   order by (w.status in ('klar', 'nej')), w.votes desc, w.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
end; $function$;
