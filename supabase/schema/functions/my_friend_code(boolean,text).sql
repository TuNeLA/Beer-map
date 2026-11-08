-- public.my_friend_code(p_new boolean, p_name text)
-- live md5(pg_get_functiondef) = 19aa62f59c2e3d5ffc28e08697fb2002
CREATE OR REPLACE FUNCTION public.my_friend_code(p_new boolean DEFAULT false, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  c public.friend_codes;
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  perform pg_advisory_xact_lock(hashtextextended('olnu_fcode:' || v_uid::text, 0));
  select * into c from public.friend_codes x where x.user_id = v_uid;
  if not found then
    insert into public.friend_codes (user_id, code) values (v_uid, public.olnu_friend_newcode()) returning * into c;
  elsif coalesce(p_new, false) then
    if c.changes >= 10 and c.created_at > now() - interval '1 day' then raise exception 'slow_down'; end if;
    update public.friend_codes x
       set code = public.olnu_friend_newcode(),
           changes = case when x.created_at > now() - interval '1 day' then x.changes + 1 else 1 end,
           created_at = now()
     where x.user_id = v_uid returning * into c;
  end if;
  return jsonb_build_object('code', c.code);
end; $function$;
