-- public.party_create(p_group_id uuid, p_name text, p_game text)
-- live md5(pg_get_functiondef) = b589375e006c224ac825643111a55a31
CREATE OR REPLACE FUNCTION public.party_create(p_group_id uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text, p_game text DEFAULT 'imposter'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid(); v_name text; v_code text; v_id uuid; v_try int := 0; v_gname text;
  v_abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
begin
  if p_game is null or p_game not in ('imposter', 'survivor', 'hatten', 'flocken', 'vagen') then raise exception 'invalid_game'; end if;
  if p_group_id is not null then
    select gm.display_name into v_gname from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid;
    if not found then
      if public.olnu_evg_member(p_group_id, v_uid) then v_gname := public.olnu_friend_name(v_uid);
      else raise exception 'not_member'; end if;
    end if;
  end if;
  v_name := public.olnu_party_name(coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_gname));
  if v_name is null then raise exception 'invalid_name'; end if;
  if not public.olnu_party_lim(v_uid, 'create', 15, interval '1 hour') then raise exception 'slow_down'; end if;
  update public.party_rooms set closed = true, v = v + 1, updated_at = now()
   where host = v_uid and not closed and expires_at > now();
  loop
    v_try := v_try + 1;
    v_code := '';
    for i in 1..4 loop v_code := v_code || substr(v_abc, 1 + floor(random() * length(v_abc))::int, 1); end loop;
    exit when not exists (select 1 from public.party_rooms r where r.code = v_code and not r.closed and r.expires_at > now());
    if v_try > 40 then raise exception 'busy'; end if;
  end loop;
  insert into public.party_rooms (code, host, group_id, game) values (v_code, v_uid, p_group_id, p_game) returning id into v_id;
  insert into public.party_players (room_id, user_id, k, name, is_host, status, ord)
  values (v_id, v_uid, public.olnu_party_k(v_id, v_uid), v_name, true, 'in', 0);
  return public.olnu_party_view(v_id, v_uid);
end; $function$;
