-- public.olnu_medal_eval_bars(p_uid uuid)
-- live md5(pg_get_functiondef) = 649c254d78323e682ebd140ea45231eb
CREATE OR REPLACE FUNCTION public.olnu_medal_eval_bars(p_uid uuid)
 RETURNS TABLE(medal text, n integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_q int := 0; v_s int := 0; v_e int := 0; v_t int := 0;
begin
  begin
    select count(*) into v_q from public.bar_queue q where q.user_id = p_uid;
    select count(distinct bt.type) into v_s from public.beer_types bt where bt.user_id = p_uid and bt.type <> 'annan';
    select count(*) into v_e from public.bar_takeovers t
      join public.group_members m on m.group_id = t.group_id and m.user_id = p_uid
     where t.created_at >= m.joined_at;
    select count(*) into v_t from public.bar_tips t where t.user_id = p_uid;
  exception when others then
    return;
  end;
  return query
  select v.medal, v.n from (values
    ('kospanare', case when v_q >= 5 then 1 else 0 end),
    ('sommelier', case when v_s >= 5 then 1 else 0 end),
    ('erovrare', v_e),
    ('tipsare', case when v_t >= 3 then 1 else 0 end)
  ) as v(medal, n);
end;
$function$;
