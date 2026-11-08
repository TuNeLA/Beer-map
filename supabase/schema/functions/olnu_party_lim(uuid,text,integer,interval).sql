-- public.olnu_party_lim(p_uid uuid, p_kind text, p_max integer, p_win interval)
-- live md5(pg_get_functiondef) = 413be2f685879facbd243a91fa016980
CREATE OR REPLACE FUNCTION public.olnu_party_lim(p_uid uuid, p_kind text, p_max integer, p_win interval)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n int;
begin
  insert into public.party_limits as l (user_id, kind, win_start, n) values (p_uid, p_kind, now(), 1)
  on conflict (user_id, kind) do update
    set n = case when l.win_start < now() - p_win then 1 else l.n + 1 end,
        win_start = case when l.win_start < now() - p_win then now() else l.win_start end
  returning n into v_n;
  return v_n <= p_max;
end; $function$;
