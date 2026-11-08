-- public.owner_wishes(p_key text)
-- live md5(pg_get_functiondef) = c451d62e88e8f69474e85f733b027606
CREATE OR REPLACE FUNCTION public.owner_wishes(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(), 'total', (select count(*) from public.feature_wishes),
    'wishes', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'body', w.body, 'category', w.category, 'name', w.name,
                 'votes', w.votes, 'status', w.status, 'created_at', w.created_at) order by w.votes desc, w.created_at desc)
              from (select * from public.feature_wishes x order by x.votes desc, x.created_at desc limit 1000) w), '[]'::jsonb));
end; $function$;
