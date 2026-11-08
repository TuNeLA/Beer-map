-- public.olnu_party_need(p_room uuid)
-- live md5(pg_get_functiondef) = 140c0393cc23d48450368deb9229680c
CREATE OR REPLACE FUNCTION public.olnu_party_need(p_room uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.party_rooms;
begin
  select * into r from public.party_rooms where id = p_room;
  if r.id is null then return '{}'::uuid[]; end if;
  if r.game = 'imposter' then
    if r.phase in ('roles', 'vote') then return public.olnu_party_ids(p_room, 'in'); end if;
    if r.phase = 'guess' and r.sec ? 'guesser' then return array[(r.sec->>'guesser')::uuid]; end if;
  elsif r.game = 'survivor' then
    if r.phase = 'vote' then return public.olnu_party_ids(p_room, 'in'); end if;
    if r.phase = 'final' then
      return coalesce(array(select p.user_id from public.party_players p where p.room_id = p_room and p.status = 'out' and p.in_game order by p.ord), '{}'::uuid[]);
    end if;
  elsif r.game in ('hatten', 'flocken') then
    if r.phase in ('write', 'vote') then return public.olnu_party_ids(p_room, 'in'); end if;
  elsif r.game = 'vagen' then
    if r.phase = 'guess' then
      return coalesce(array(select p.user_id from public.party_players p where p.room_id = p_room and p.status = 'in'
                             and p.k is distinct from r.pub->>'psy_k' order by p.ord), '{}'::uuid[]);
    end if;
  end if;
  return '{}'::uuid[];
end; $function$;
