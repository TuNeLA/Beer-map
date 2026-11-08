-- public.olnu_g_oracle(p_group uuid, p_night timestamp with time zone, p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = 07c17d55be265c1881c6a082aa1016f9
CREATE OR REPLACE FUNCTION public.olnu_g_oracle(p_group uuid, p_night timestamp with time zone, p_now timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_now < p_night or exists (select 1 from public.game_oracles o where o.group_id = p_group and o.night = p_night) then
    return;
  end if;
  update public.game_guesses g set real = public.olnu_g_real(g.night, g.lat, g.lng)
   where g.night = p_night and g.real is null
     and g.user_id in (select m.user_id from public.group_members m where m.group_id = p_group);
  insert into public.game_oracles (group_id, night, user_id, guess, real, err, guessers)
  select p_group, p_night, x.user_id, x.guess, x.real, x.err, x.cnt from (
    select g.user_id, g.guess, g.real, g.created_at,
           abs(g.guess - g.real)::float8 / greatest(g.real, 1) as err,
           count(*) over () as cnt
      from public.game_guesses g
      join public.group_members m on m.user_id = g.user_id and m.group_id = p_group
     where g.night = p_night and g.real is not null) x
   where x.cnt >= 2
   order by x.err, x.created_at, x.user_id
   limit 1
  on conflict do nothing;
end;
$function$;
