-- public.owner_set_bar_photo(p_key text, p_id bigint, p_status text)
-- live md5(pg_get_functiondef) = 3aeeb35c9a3f9d521dd90c5599399b63
CREATE OR REPLACE FUNCTION public.owner_set_bar_photo(p_key text, p_id bigint, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s text := lower(btrim(coalesce(p_status, '')));
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if v_s not in ('ok', 'hidden') then raise exception 'invalid_status'; end if;
  update public.bar_photos
     set hidden_at = case when v_s = 'hidden' then coalesce(hidden_at, now()) end,
         hidden_by = case when v_s = 'hidden' then 'owner' end
   where id = p_id;
  if not found then raise exception 'photo_not_found'; end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', v_s);
end; $function$;
