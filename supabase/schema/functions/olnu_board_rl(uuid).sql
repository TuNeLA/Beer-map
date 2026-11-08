-- public.olnu_board_rl(p_uid uuid)
-- live md5(pg_get_functiondef) = daf315eea6f742e7d201d7fea8903e86
CREATE OR REPLACE FUNCTION public.olnu_board_rl(p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_n int;
begin
  insert into public.board_rl as r (user_id, win, n) values (p_uid, date_trunc('minute', now()), 1)
  on conflict (user_id) do update
     set n = case when r.win = excluded.win then r.n + 1 else 1 end, win = excluded.win
  returning r.n into v_n;
  if v_n > 30 then
    raise exception 'slow_down';
  end if;
end; $function$;
