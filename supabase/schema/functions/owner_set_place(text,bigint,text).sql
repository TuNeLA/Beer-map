-- public.owner_set_place(p_key text, p_id bigint, p_status text)
-- live md5(pg_get_functiondef) = 0a8ff69005b29b083ca5bd4cb8bb26af
CREATE OR REPLACE FUNCTION public.owner_set_place(p_key text, p_id bigint, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_s text := lower(btrim(coalesce(p_status, '')));
  s public.place_suggestions;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  if v_s not in ('pending', 'ok', 'rejected') then raise exception 'invalid_status'; end if;
  update public.place_suggestions x set status = v_s, status_at = now() where x.id = p_id returning * into s;
  if not found then raise exception 'place_not_found'; end if;
  if v_s = 'ok' then
    insert into public.bars_lite (id, name, lat, lng, type, active, updated_at)
    values (s.bar_id, s.name, s.lat, s.lng, case when s.type = 'other' then 'bar' else s.type end, true, now())
    on conflict (id) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng, type = excluded.type,
                                   active = true, updated_at = now();
  else
    update public.bars_lite b set active = false, updated_at = now() where b.id = s.bar_id and b.active;
  end if;
  return jsonb_build_object('ok', true, 'status', v_s, 'bar_id', s.bar_id);
end; $function$;
