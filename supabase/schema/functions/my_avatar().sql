-- public.my_avatar()
-- live md5(pg_get_functiondef) = 24451c45105af5aecaa1bbe4cfa9f10a
CREATE OR REPLACE FUNCTION public.my_avatar()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v_spec jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select a.spec into v_spec from public.avatars a where a.user_id = v_uid;
  return jsonb_build_object('v', 2, 'spec', v_spec, 'seed', public.olnu_avatar_seed(v_uid),
                            'facts', public.olnu_avatar_facts(v_uid));
end; $function$;
