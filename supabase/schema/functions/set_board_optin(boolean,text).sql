-- public.set_board_optin(p_on boolean, p_name text)
-- live md5(pg_get_functiondef) = 3433ad2c6a92a608e4eb1fb1e3e703d7
CREATE OR REPLACE FUNCTION public.set_board_optin(p_on boolean, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_name text := btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
  v_row  public.board_optin%rowtype;
begin
  if p_name is not null and char_length(v_name) not between 1 and 30 then
    raise exception 'invalid_name';
  end if;
  insert into public.board_optin as o (user_id, show, name, updated_at)
  values (v_uid, coalesce(p_on, false), nullif(v_name, ''), now())
  on conflict (user_id) do update
     set show = excluded.show, name = coalesce(excluded.name, o.name), updated_at = now()
  returning * into v_row;
  return jsonb_build_object('on', v_row.show, 'name', v_row.name);
end; $function$;
