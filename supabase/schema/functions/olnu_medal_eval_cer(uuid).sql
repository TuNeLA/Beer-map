-- public.olnu_medal_eval_cer(p_uid uuid)
-- live md5(pg_get_functiondef) = f60291489e765f09c1138f03e5ab832a
CREATE OR REPLACE FUNCTION public.olnu_medal_eval_cer(p_uid uuid)
 RETURNS TABLE(medal text, n integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  select 'cer_' || r.cat, count(distinct (r.group_id, r.night))::int
    from public.cer_results r where r.winner = p_uid group by r.cat;
exception when others then
  return;
end;
$function$;
