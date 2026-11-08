-- public.olnu_avatar_pub(p_uid uuid)
-- live md5(pg_get_functiondef) = 8921ee09251a3b41eccb2613366f04e1
CREATE OR REPLACE FUNCTION public.olnu_avatar_pub(p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_spec jsonb; v_r int := 1; v_md jsonb := '[]'::jsonb;
begin
  select a.spec into v_spec from public.avatars a where a.user_id = p_uid;
  begin select ro.idx into v_r from public.olnu_rank_of(coalesce(public.olnu_meriter(p_uid), 0)) ro; exception when others then v_r := 1; end;
  if coalesce((v_spec->>'ms')::int, 1) = 1 then
    if jsonb_typeof(v_spec->'md') = 'array' and jsonb_array_length(v_spec->'md') > 0 then
      select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into v_md
        from jsonb_array_elements_text(v_spec->'md') with ordinality t(x, o)
       where exists (select 1 from public.user_medals um where um.user_id = p_uid and um.medal = t.x);
    else
      select coalesce(jsonb_agg(z.medal order by z.earned_at desc), '[]'::jsonb) into v_md
        from (select um.medal, um.earned_at from public.user_medals um
               where um.user_id = p_uid and um.medal not in ('het', 'medevac')
               order by um.earned_at desc limit 5) z;
    end if;
  end if;
  return jsonb_build_object('seed', public.olnu_avatar_seed(p_uid), 'a', v_spec, 'r', coalesce(v_r, 1), 'md', v_md);
end; $function$;
