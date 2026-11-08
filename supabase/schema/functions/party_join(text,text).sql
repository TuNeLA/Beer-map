-- public.party_join(p_code text, p_name text)
-- live md5(pg_get_functiondef) = 04b2d4b156bd55c63eb63d66357a827b
CREATE OR REPLACE FUNCTION public.party_join(p_code text, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid(); v_code text; r public.party_rooms; v_name text; v_gname text; v_n int; v_old public.party_players;
  v_base text; v_i int := 1;
begin
  if not public.olnu_party_lim(v_uid, 'join', 30, interval '10 minutes') then raise exception 'slow_down'; end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z]', '', 'g'));
  if length(v_code) <> 4 then raise exception 'room_not_found'; end if;
  select * into r from public.party_rooms where code = v_code and not closed and expires_at > now()
   order by created_at desc limit 1 for update;
  if r.id is null then raise exception 'room_not_found'; end if;
  select * into v_old from public.party_players where room_id = r.id and user_id = v_uid;
  if r.group_id is not null then
    select gm.display_name into v_gname from public.group_members gm where gm.group_id = r.group_id and gm.user_id = v_uid;
    if v_gname is null and public.olnu_evg_member(r.group_id, v_uid) then v_gname := public.olnu_friend_name(v_uid); end if;
  end if;
  v_name := public.olnu_party_name(coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_gname, v_old.name));
  if v_name is null then raise exception 'invalid_name'; end if;
  v_base := v_name;
  while exists (select 1 from public.party_players p where p.room_id = r.id and p.user_id <> v_uid and p.status <> 'left'
                 and lower(p.name) = lower(v_name)) loop
    v_i := v_i + 1; v_name := left(v_base, 17) || ' ' || v_i;
  end loop;
  if v_old.user_id is null then
    select count(*) into v_n from public.party_players p where p.room_id = r.id and p.status <> 'left';
    if v_n >= 16 then raise exception 'room_full'; end if;
    insert into public.party_players (room_id, user_id, k, name, status, ord)
    values (r.id, v_uid, public.olnu_party_k(r.id, v_uid), v_name, case when r.phase in ('lobby', 'end') then 'in' else 'wait' end, 900);
  else
    update public.party_players set name = v_name, seen_at = now(),
           status = case when status = 'left' then case when r.phase in ('lobby', 'end') then 'in' else 'wait' end else status end
     where room_id = r.id and user_id = v_uid;
  end if;
  update public.party_rooms set v = v + 1, updated_at = now() where id = r.id;
  return public.olnu_party_view(r.id, v_uid);
end; $function$;
