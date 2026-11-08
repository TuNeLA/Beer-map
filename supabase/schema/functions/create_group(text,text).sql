-- public.create_group(p_name text, p_display_name text)
-- live md5(pg_get_functiondef) = 92fa8576d0062dac60be0119a5b94bb4
CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_display_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid      uuid := public.olnu_uid();
  v_name     text := btrim(coalesce(p_name, ''));
  v_display  text := public.olnu_clean_display_name(p_display_name);
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code     text;
  v_id       uuid;
  v_try      int := 0;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'invalid_name';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_mkgroup:' || coalesce(v_uid::text, ''), 0));
  if (select count(*) from public.groups g where g.created_by = v_uid and g.created_at > now() - interval '24 hours') >= 6 then
    raise exception 'slow_down';
  end if;
  loop
    v_try := v_try + 1;
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * 32)::int, 1);
    end loop;
    insert into public.groups (name, code, created_by)
    values (v_name, v_code, v_uid)
    on conflict (code) do nothing
    returning groups.id into v_id;
    exit when v_id is not null;
    if v_try >= 20 then
      raise exception 'code_generation_failed';
    end if;
  end loop;
  insert into public.group_members (group_id, user_id, display_name)
  values (v_id, v_uid, v_display);
  return json_build_object('id', v_id, 'name', v_name, 'code', v_code);
end;
$function$;
