-- public.olnu_friend_newcode()
-- live md5(pg_get_functiondef) = bc1e779c02c963366aef12297100fb16
CREATE OR REPLACE FUNCTION public.olnu_friend_newcode()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v text; i int; n int := 0;
begin
  loop
    v := '';
    for i in 1..7 loop v := v || substr(v_abc, 1 + floor(random() * 32)::int, 1); end loop;
    exit when not exists (select 1 from public.friend_codes c where c.code = v);
    n := n + 1;
    if n > 20 then raise exception 'code_generation_failed'; end if;
  end loop;
  return v;
end; $function$;
