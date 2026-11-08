-- public.set_my_avatar(p_spec jsonb)
-- live md5(pg_get_functiondef) = 433c45f4e26871d3acc4f4754d3b28f1
CREATE OR REPLACE FUNCTION public.set_my_avatar(p_spec jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v_clean jsonb; v_at timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select a.updated_at into v_at from public.avatars a where a.user_id = v_uid;
  if v_at is not null and v_at > now() - interval '2 seconds' then raise exception 'slow_down'; end if;
  v_clean := public.olnu_avatar_clean(v_uid, p_spec);
  insert into public.avatars(user_id, spec, updated_at) values (v_uid, v_clean, now())
  on conflict (user_id) do update set spec = excluded.spec, updated_at = now();
  return jsonb_build_object('ok', true, 'spec', v_clean);
end; $function$;
