-- public.olnu_resolve_pin(p_uid uuid, p_pin text)
-- live md5(pg_get_functiondef) = f144da5887a57dba9e213a43edc5fc5c
CREATE OR REPLACE FUNCTION public.olnu_resolve_pin(p_uid uuid, p_pin text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_pin    text := btrim(coalesce(p_pin, ''));
  v_secret text := (select s.secret from public.olnu_secrets s where s.id = 1);
  v_bucket bigint := floor(extract(epoch from now()) / 600)::bigint;
  v_id     bigint;
begin
  if v_pin ~ '^[0-9]{1,18}$' then
    select b.id into v_id
      from public.beers b
     where b.id = v_pin::bigint and b.expires_at > now() and not b.stopped
       and (b.user_id = p_uid
            or exists (select 1 from public.group_members am
                         join public.group_members cm on cm.group_id = am.group_id and cm.user_id = p_uid
                        where am.user_id = b.user_id));
    return v_id;
  end if;
  if v_pin !~ '^p[0-9a-f]{15}$' then
    return null;
  end if;
  select b.id into v_id
    from public.beers b
   where b.expires_at > now() and not b.stopped
     and ('p' || left(md5(v_secret || ':' || b.id::text || ':' || v_bucket::text), 15) = v_pin
          or 'p' || left(md5(v_secret || ':' || b.id::text || ':' || (v_bucket - 1)::text), 15) = v_pin)
   limit 1;
  return v_id;
end;
$function$;
