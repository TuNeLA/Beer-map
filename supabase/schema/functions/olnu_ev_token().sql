-- public.olnu_ev_token()
-- live md5(pg_get_functiondef) = e1af42525e68e22002b0c6f20d1991ce
CREATE OR REPLACE FUNCTION public.olnu_ev_token()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  t text;
  i int;
  n int := 0;
begin
  loop
    n := n + 1;
    t := '';
    for i in 1..6 loop t := t || substr(a, 1 + floor(random() * 32)::int, 1); end loop;
    exit when not exists (select 1 from public.ev_links l where l.token = t)
          and not exists (select 1 from public.groups g where upper(g.code) = t);
    if n > 20 then raise exception 'code_generation_failed'; end if;
  end loop;
  return t;
end;
$function$;
