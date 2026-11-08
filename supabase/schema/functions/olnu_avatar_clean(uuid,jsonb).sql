-- public.olnu_avatar_clean(p_uid uuid, p_spec jsonb)
-- live md5(pg_get_functiondef) = eeceef04c2c64ea083056b9bc82b17e6
CREATE OR REPLACE FUNCTION public.olnu_avatar_clean(p_uid uuid, p_spec jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_max jsonb := public.olnu_avatar_max();
  v_locks jsonb := public.olnu_avatar_locks() || public.olnu_avatar_locks3();
  v_f jsonb := public.olnu_avatar_facts(p_uid);
  v_cur jsonb;
  v_out jsonb := jsonb_build_object('v', 2);
  k text; val jsonb; n int; lk jsonb; md jsonb := '[]'::jsonb; x jsonb;
begin
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' or octet_length(p_spec::text) > 1024 then
    raise exception 'invalid_avatar';
  end if;
  select a.spec into v_cur from public.avatars a where a.user_id = p_uid;
  for k, val in select * from jsonb_each(p_spec) loop
    if k = 'v' then continue; end if;
    if k = 'md' then
      if jsonb_typeof(val) <> 'array' or jsonb_array_length(val) > 6 then raise exception 'invalid_avatar'; end if;
      for x in select * from jsonb_array_elements(val) loop
        if jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 24 or (x #>> '{}') in ('het', 'medevac')
           or not (v_f->'m') ? (x #>> '{}') then raise exception 'invalid_avatar'; end if;
        if not md ? (x #>> '{}') then md := md || jsonb_build_array(x); end if;
      end loop;
      continue;
    end if;
    if not v_max ? k or jsonb_typeof(val) <> 'number' then raise exception 'invalid_avatar'; end if;
    n := (val #>> '{}')::numeric::int;
    if n::numeric <> (val #>> '{}')::numeric or n < 0 or n > (v_max->>k)::int then raise exception 'invalid_avatar'; end if;
    lk := v_locks->(k || ':' || n);
    if lk is not null and not public.olnu_avatar_lock_ok(lk, v_f)
       and not (case when jsonb_typeof(v_cur->k) = 'number' then (v_cur->>k)::numeric = n else false end) then
      raise exception 'locked';
    end if;
    v_out := v_out || jsonb_build_object(k, n);
  end loop;
  if jsonb_array_length(md) > 0 then v_out := v_out || jsonb_build_object('md', md); end if;
  return v_out;
end; $function$;
