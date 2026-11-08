-- public.accept_terms(p_ver integer)
-- live md5(pg_get_functiondef) = d6bcc2d4d644518c6c4e4a7a3139fba0
CREATE OR REPLACE FUNCTION public.accept_terms(p_ver integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v int := greatest(1, least(coalesce(p_ver, 1), 99));
begin
  insert into public.user_safety as u (user_id, terms_ver, terms_at, updated_at)
  values (v_uid, v, now(), now())
  on conflict (user_id) do update set terms_ver = greatest(coalesce(u.terms_ver, 0), v), terms_at = now(), updated_at = now();
  return jsonb_build_object('terms_ver', v, 'terms_at', now());
end; $function$;
