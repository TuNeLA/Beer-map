-- public.olnu_party_list(p jsonb, p_min integer, p_max integer, p_len integer)
-- live md5(pg_get_functiondef) = 8c495cf52a076039c88d90b52840a7fb
CREATE OR REPLACE FUNCTION public.olnu_party_list(p jsonb, p_min integer, p_max integer, p_len integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' then raise exception 'invalid_content'; end if;
  select coalesce(jsonb_agg(x.t order by x.i), '[]'::jsonb) into v from (
    select public.olnu_party_text(e.val, p_len) as t, e.i from jsonb_array_elements_text(p) with ordinality as e(val, i)
  ) x where x.t is not null and x.i <= p_max;
  if jsonb_array_length(v) < p_min then raise exception 'invalid_content'; end if;
  return v;
end; $function$;
