-- public.olnu_card_rl(p_ip text)
-- live md5(pg_get_functiondef) = 6f1e408766fdd7a848854470cc52d3db
CREATE OR REPLACE FUNCTION public.olnu_card_rl(p_ip text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_min timestamptz := date_trunc('minute', now());
  v_b int := abs(hashtext('olnu-card:' || coalesce(p_ip, '-'))) % 4096;
  v_n int; v_g int;
begin
  insert into public.card_rl as r (bucket, minute, n) values (v_b, v_min, 1)
  on conflict (bucket) do update set n = case when r.minute = v_min then r.n + 1 else 1 end, minute = v_min
  returning n into v_n;
  insert into public.card_rl as r (bucket, minute, n) values (-1, v_min, 1)
  on conflict (bucket) do update set n = case when r.minute = v_min then r.n + 1 else 1 end, minute = v_min
  returning n into v_g;
  return v_n <= 60 and v_g <= 1500;
end; $function$;
