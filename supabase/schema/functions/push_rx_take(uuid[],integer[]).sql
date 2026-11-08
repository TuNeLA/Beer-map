-- public.push_rx_take(p_uids uuid[], p_caps integer[])
-- live md5(pg_get_functiondef) = a441c442497b652d6937c8cea8e47b33
CREATE OR REPLACE FUNCTION public.push_rx_take(p_uids uuid[], p_caps integer[])
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_night timestamptz := public.olnu_night_of(now()); i int; v_u uuid; v_cap int; v_got uuid;
begin
  for i in 1 .. coalesce(array_length(p_uids, 1), 0) loop
    v_u := p_uids[i]; v_cap := greatest(1, coalesce(p_caps[i], 15));
    if v_u is null then continue; end if;
    v_got := null;
    insert into public.push_rx as r (user_id, night, n) values (v_u, v_night, 1)
      on conflict (user_id, night) do update set n = r.n + 1 where r.n < v_cap
      returning r.user_id into v_got;
    if v_got is not null then return next v_u; end if;
  end loop;
end $function$;
