-- public.olnu_medal_eval_after(p_uid uuid)
-- live md5(pg_get_functiondef) = 74e798d42156b85b4271a75a6cc4da1f
CREATE OR REPLACE FUNCTION public.olnu_medal_eval_after(p_uid uuid)
 RETURNS TABLE(medal text, n integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_jul int := 0; v_fett int := 0; v_pask int := 0; v_adv int := 0; v_f13 int := 0; v_hall int := 0; v_kraft int := 0;
  v_kv int := 0;
begin
  begin
    select count(distinct extract(year from x.ev)) filter (where x.h = 'julafton'),
           count(distinct extract(year from x.ev)) filter (where x.h = 'fettisdagen'),
           count(distinct extract(year from x.ev)) filter (where x.h = 'pask'),
           count(distinct extract(year from x.ev)) filter (where x.h = 'forstaAdvent'),
           count(distinct x.ev) filter (where x.h = 'fredag13'),
           count(distinct extract(year from x.ev)) filter (where x.h = 'halloween'),
           count(distinct extract(year from x.ev)) filter (where x.h = 'kraftskiva')
      into v_jul, v_fett, v_pask, v_adv, v_f13, v_hall, v_kraft
      from (select public.olnu_evening(mn.night) as ev, public.olnu_holiday(public.olnu_evening(mn.night)) as h
              from public.medal_nights mn where mn.user_id = p_uid and mn.beers >= 1) x
     where x.h is not null;
    select count(*) into v_kv from public.medevac_checks c where c.checker = p_uid;
  exception when others then
    return;
  end;
  return query
  select v.medal, v.n from (values
    ('jul', v_jul), ('fettis', v_fett), ('pask', v_pask), ('advent', v_adv),
    ('fredag13', v_f13), ('halloween', v_hall), ('kraftskiva', v_kraft), ('kompisvakt', v_kv)
  ) as v(medal, n);
end;
$function$;
