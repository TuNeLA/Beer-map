-- public.olnu_holiday(p_day date)
-- live md5(pg_get_functiondef) = 204786ca55ff400914c1091ca064a858
CREATE OR REPLACE FUNCTION public.olnu_holiday(p_day date)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_md  text := to_char(p_day, 'MM-DD');
  v_dow int := extract(isodow from p_day)::int;
  v_e   date := public.olnu_easter(extract(year from p_day)::int);
  v_adv date;
begin
  if v_md = '12-24' then return 'julafton'; end if;
  if v_md = '12-31' then return 'nyarsafton'; end if;
  if v_md = '12-13' then return 'lucia'; end if;
  if v_md = '04-30' then return 'valborg'; end if;
  if v_md = '10-31' then return 'halloween'; end if;
  if v_dow = 5 and v_md between '06-19' and '06-25' then return 'midsommar'; end if;
  if p_day between v_e - 2 and v_e then return 'pask'; end if;
  if p_day = v_e - 47 then return 'fettisdagen'; end if;
  v_adv := make_date(extract(year from p_day)::int, 12, 3);
  v_adv := v_adv - (extract(isodow from v_adv)::int % 7);
  if p_day = v_adv then return 'forstaAdvent'; end if;
  if v_dow = 5 and extract(day from p_day) = 13 then return 'fredag13'; end if;
  if v_dow = 5 and extract(month from p_day) = 8 then return 'kraftskiva'; end if;
  return null;
end;
$function$;
